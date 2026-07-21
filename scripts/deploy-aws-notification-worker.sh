#!/usr/bin/env bash
set -euo pipefail

environment="${1:-}"
enabled="${2:-false}"
mode="${3:-}"
region="${AWS_REGION:-ap-northeast-2}"
dev_account="200151116034"

if [[ "$environment" != "dev" && "$environment" != "prod" ]]; then
  echo "usage: $0 <dev|prod> <true|false> [--dry-run]" >&2
  exit 2
fi
if [[ "$enabled" != "true" && "$enabled" != "false" ]]; then echo "enabled must be true or false" >&2; exit 2; fi
if [[ -n "$mode" && "$mode" != "--dry-run" ]]; then echo "third argument must be --dry-run" >&2; exit 2; fi

if [[ "$environment" == "prod" ]]; then
  if [[ -z "${AWS_PROFILE:-}" ]]; then echo "prod deployment requires explicit AWS_PROFILE=coredot-prod" >&2; exit 78; fi
  if [[ "$AWS_PROFILE" != "coredot-prod" ]]; then echo "prod deployment requires the approved coredot-prod profile" >&2; exit 78; fi
  profile="$AWS_PROFILE"
  expected_account="${EXPECTED_AWS_ACCOUNT_ID:-}"
  if [[ ! "$expected_account" =~ ^[0-9]{12}$ ]]; then echo "prod deployment requires a 12-digit EXPECTED_AWS_ACCOUNT_ID" >&2; exit 78; fi
  if [[ "$expected_account" == "$dev_account" ]]; then echo "prod account must be isolated from the dev account" >&2; exit 78; fi
else
  profile="${AWS_PROFILE:-coredot-dev}"
  if [[ "$profile" == "coredot-prod" ]]; then echo "dev deployment cannot use the coredot-prod profile" >&2; exit 78; fi
  expected_account="$dev_account"
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
role_name="byus-notification-worker-${environment}-lambda"
function_name="byus-notification-worker-${environment}"
secret_name="byus/notification/${environment}"
rule_name="byus-notification-worker-${environment}-every-minute"
target_id="byus-notification-worker-${environment}"
statement_id=""
trust_policy="${repo_root}/infrastructure/aws/worker/lambda-trust-policy.json"
secret_policy_template="${repo_root}/infrastructure/aws/worker/${environment}-notification-secrets-policy.json"
bundle="${repo_root}/apps/worker/dist-lambda/notification-index.cjs"

node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"));JSON.parse(require("node:fs").readFileSync(process.argv[2],"utf8"))' "$trust_policy" "$secret_policy_template"
if [[ "$environment" == "prod" ]] && ! grep -q '__EXPECTED_AWS_ACCOUNT_ID__' "$secret_policy_template"; then echo "prod secret policy account placeholder is missing" >&2; exit 78; fi
npm run build:lambda --workspace @byus/worker >/dev/null
node --check "$bundle"

if [[ "$mode" == "--dry-run" ]]; then
  printf 'validated notification deployment: environment=%s enabled=%s profile=%s account=%s function=%s rule=%s schedule=%s secret=%s\n' \
    "$environment" "$enabled" "$profile" "$expected_account" "$function_name" "$rule_name" 'rate(1 minute)' "$secret_name"
  exit 0
fi

for command in aws zip mktemp; do command -v "$command" >/dev/null || { echo "missing required command: $command" >&2; exit 78; }; done
account="$(aws sts get-caller-identity --profile "$profile" --query Account --output text)"
if [[ "$account" != "$expected_account" ]]; then echo "AWS account mismatch" >&2; exit 78; fi
if [[ "$region" != "ap-northeast-2" ]]; then echo "AWS region must be ap-northeast-2" >&2; exit 78; fi
if [[ "$enabled" == "true" ]]; then aws secretsmanager describe-secret --profile "$profile" --region "$region" --secret-id "$secret_name" >/dev/null; fi

package_dir="$(mktemp -d)"
trap 'rm -rf "$package_dir"' EXIT
secret_policy="$secret_policy_template"
if [[ "$environment" == "prod" ]]; then
  EXPECTED_ACCOUNT="$expected_account" POLICY_TEMPLATE="$secret_policy_template" POLICY_OUTPUT="${package_dir}/prod-secrets-policy.json" node -e 'const fs=require("node:fs");const source=fs.readFileSync(process.env.POLICY_TEMPLATE,"utf8");const rendered=source.replaceAll("__EXPECTED_AWS_ACCOUNT_ID__",process.env.EXPECTED_ACCOUNT);const policy=JSON.parse(rendered);if(policy.Statement.some(statement=>!String(statement.Resource).includes(`:${process.env.EXPECTED_ACCOUNT}:secret:byus/notification/prod-`)))throw new Error("invalid rendered prod policy");fs.writeFileSync(process.env.POLICY_OUTPUT,JSON.stringify(policy))'
  secret_policy="${package_dir}/prod-secrets-policy.json"
fi
cp "$bundle" "${package_dir}/index.cjs"
(cd "$package_dir" && zip -q lambda-package.zip index.cjs)
package_file="${package_dir}/lambda-package.zip"

if ! aws iam get-role --profile "$profile" --role-name "$role_name" >/dev/null 2>&1; then
  aws iam create-role --profile "$profile" --role-name "$role_name" --assume-role-policy-document "file://${trust_policy}" >/dev/null
fi
aws iam attach-role-policy --profile "$profile" --role-name "$role_name" --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --profile "$profile" --role-name "$role_name" --policy-name "byus-notification-worker-${environment}-secret-read" --policy-document "file://${secret_policy}"
aws iam wait role-exists --profile "$profile" --role-name "$role_name"
role_arn="$(aws iam get-role --profile "$profile" --role-name "$role_name" --query 'Role.Arn' --output text)"

lambda_environment="Variables={NOTIFICATION_WORKER_ENABLED=${enabled},NOTIFICATION_WORKER_ENVIRONMENT=${environment},NOTIFICATION_WORKER_SECRET_ID=${secret_name}}"
create_notification_lambda() {
  local attempt=1
  local max_attempts=12
  local retry_delay_seconds=5
  local error_file="${package_dir}/create-function-error.txt"
  while (( attempt <= max_attempts )); do
    if aws lambda create-function --profile "$profile" --region "$region" --function-name "$function_name" --runtime nodejs24.x --architectures arm64 --role "$role_arn" --handler index.handler --zip-file "fileb://${package_file}" --timeout 60 --memory-size 256 --environment "$lambda_environment" > /dev/null 2>"$error_file"; then
      return 0
    fi
    if ! grep -Fq 'role defined for the function cannot be assumed by Lambda' "$error_file"; then
      cat "$error_file" >&2
      return 1
    fi
    if (( attempt == max_attempts )); then
      echo "Lambda role propagation did not converge after ${max_attempts} attempts" >&2
      cat "$error_file" >&2
      return 1
    fi
    sleep "$retry_delay_seconds"
    attempt=$((attempt + 1))
  done
}
if aws lambda get-function --profile "$profile" --region "$region" --function-name "$function_name" >/dev/null 2>&1; then
  aws lambda update-function-code --profile "$profile" --region "$region" --function-name "$function_name" --zip-file "fileb://${package_file}" >/dev/null
  aws lambda wait function-updated-v2 --profile "$profile" --region "$region" --function-name "$function_name"
  aws lambda update-function-configuration --profile "$profile" --region "$region" --function-name "$function_name" --runtime nodejs24.x --handler index.handler --timeout 60 --memory-size 256 --environment "$lambda_environment" >/dev/null
else
  create_notification_lambda
fi
aws lambda wait function-active-v2 --profile "$profile" --region "$region" --function-name "$function_name"
aws lambda put-function-concurrency --profile "$profile" --region "$region" --function-name "$function_name" --reserved-concurrent-executions 1 >/dev/null
function_arn="$(aws lambda get-function-configuration --profile "$profile" --region "$region" --function-name "$function_name" --query FunctionArn --output text)"

case "$environment" in dev) statement_id="AllowEventBridgeNotificationWorkerDev" ;; prod) statement_id="AllowEventBridgeNotificationWorkerProd" ;; esac
rule_state="DISABLED"; [[ "$enabled" == "true" ]] && rule_state="ENABLED"
rule_arn="$(aws events put-rule --profile "$profile" --region "$region" --name "$rule_name" --schedule-expression 'rate(1 minute)' --state "$rule_state" --query RuleArn --output text)"
policy=""
if aws lambda get-policy --profile "$profile" --region "$region" --function-name "$function_name" --query Policy --output text >"${package_dir}/lambda-policy.txt" 2>/dev/null; then policy="$(<"${package_dir}/lambda-policy.txt")"; fi
if [[ "$policy" != *"${statement_id}"* ]]; then
  aws lambda add-permission --profile "$profile" --region "$region" --function-name "$function_name" --statement-id "$statement_id" --action lambda:InvokeFunction --principal events.amazonaws.com --source-arn "$rule_arn" >/dev/null
fi
FUNCTION_ARN="$function_arn" TARGET_ID="$target_id" TARGET_ENVIRONMENT="$environment" node -e 'const input=JSON.stringify({source:"byus.notification-cron",environment:process.env.TARGET_ENVIRONMENT});process.stdout.write(JSON.stringify([{Id:process.env.TARGET_ID,Arn:process.env.FUNCTION_ARN,Input:input}]))' >"${package_dir}/event-target.json"
aws events put-targets --profile "$profile" --region "$region" --rule "$rule_name" --targets "file://${package_dir}/event-target.json" >/dev/null

aws lambda get-function-configuration --profile "$profile" --region "$region" --function-name "$function_name" --query '{FunctionName:FunctionName,Runtime:Runtime,State:State,Enabled:Environment.Variables.NOTIFICATION_WORKER_ENABLED,Environment:Environment.Variables.NOTIFICATION_WORKER_ENVIRONMENT}'
aws events describe-rule --profile "$profile" --region "$region" --name "$rule_name" --query '{Name:Name,State:State,ScheduleExpression:ScheduleExpression}'
