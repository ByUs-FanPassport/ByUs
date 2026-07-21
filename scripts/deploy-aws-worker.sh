#!/usr/bin/env bash
set -euo pipefail

environment="${1:-}"
enabled="${2:-false}"
profile="${AWS_PROFILE:-coredot-dev}"
region="${AWS_REGION:-ap-northeast-2}"

if [[ "$environment" != "dev" && "$environment" != "prod" ]]; then
  echo "usage: $0 <dev|prod> <true|false>" >&2
  exit 2
fi
if [[ "$enabled" != "true" && "$enabled" != "false" ]]; then
  echo "enabled must be true or false" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
role_name="byus-mint-worker-${environment}-lambda"
function_name="byus-mint-worker-${environment}"
secret_name="byus/worker/${environment}"
trust_policy="${repo_root}/infrastructure/aws/worker/lambda-trust-policy.json"
secret_policy="${repo_root}/infrastructure/aws/worker/${environment}-secrets-policy.json"
package_file="${repo_root}/apps/worker/lambda-package.zip"

if ! aws iam get-role --profile "$profile" --role-name "$role_name" >/dev/null 2>&1; then
  aws iam create-role --profile "$profile" --role-name "$role_name" \
    --assume-role-policy-document "file://${trust_policy}" >/dev/null
fi
aws iam attach-role-policy --profile "$profile" --role-name "$role_name" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
aws iam put-role-policy --profile "$profile" --role-name "$role_name" \
  --policy-name "byus-worker-${environment}-secret-read" \
  --policy-document "file://${secret_policy}"

role_arn="$(aws iam get-role --profile "$profile" --role-name "$role_name" --query 'Role.Arn' --output text)"
if aws lambda get-function --profile "$profile" --region "$region" --function-name "$function_name" >/dev/null 2>&1; then
  aws lambda update-function-code --profile "$profile" --region "$region" \
    --function-name "$function_name" --zip-file "fileb://${package_file}" >/dev/null
  aws lambda wait function-updated-v2 --profile "$profile" --region "$region" --function-name "$function_name"
  aws lambda update-function-configuration --profile "$profile" --region "$region" \
    --function-name "$function_name" --runtime nodejs24.x --handler index.handler \
    --timeout 240 --memory-size 512 \
    --environment "Variables={WORKER_ENABLED=${enabled},WORKER_ENVIRONMENT=${environment},WORKER_SECRET_ID=${secret_name}}" >/dev/null
else
  sleep 8
  aws lambda create-function --profile "$profile" --region "$region" \
    --function-name "$function_name" --runtime nodejs24.x --architectures arm64 \
    --role "$role_arn" --handler index.handler --zip-file "fileb://${package_file}" \
    --timeout 240 --memory-size 512 \
    --environment "Variables={WORKER_ENABLED=${enabled},WORKER_ENVIRONMENT=${environment},WORKER_SECRET_ID=${secret_name}}" >/dev/null
fi

aws lambda wait function-active-v2 --profile "$profile" --region "$region" --function-name "$function_name"
aws lambda put-function-concurrency --profile "$profile" --region "$region" \
  --function-name "$function_name" --reserved-concurrent-executions 1 >/dev/null

aws lambda get-function-configuration --profile "$profile" --region "$region" \
  --function-name "$function_name" \
  --query '{FunctionName:FunctionName,Runtime:Runtime,Architecture:Architectures[0],State:State,Timeout:Timeout,MemorySize:MemorySize,Enabled:Environment.Variables.WORKER_ENABLED,Environment:Environment.Variables.WORKER_ENVIRONMENT}'
