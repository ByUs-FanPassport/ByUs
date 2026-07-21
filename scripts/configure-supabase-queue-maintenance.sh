#!/usr/bin/env bash
set -euo pipefail

environment_name="${1:-}"

case "$environment_name" in
  dev)
    url_variable="SUPABASE_DEV_URL"
    key_variable="SUPABASE_DEV_SERVICE_ROLE_KEY"
    secret_variable="SUPABASE_DEV_CRON_SECRET"
    ;;
  prod)
    url_variable="SUPABASE_PROD_URL"
    key_variable="SUPABASE_PROD_SERVICE_ROLE_KEY"
    secret_variable="SUPABASE_PROD_CRON_SECRET"
    ;;
  *)
    echo "usage: $0 <dev|prod>" >&2
    exit 64
    ;;
esac

supabase_url="${!url_variable:-}"
service_role_key="${!key_variable:-}"
cron_secret="${!secret_variable:-}"

if [[ -z "$supabase_url" || -z "$service_role_key" || -z "$cron_secret" ]]; then
  echo "missing required ${environment_name} Supabase environment variables" >&2
  exit 78
fi

payload="$({
  FUNCTION_URL="${supabase_url}/functions/v1/queue-maintenance" \
  CRON_SECRET="$cron_secret" \
  node -e 'process.stdout.write(JSON.stringify({p_function_url:process.env.FUNCTION_URL,p_cron_secret:process.env.CRON_SECRET}))'
})"

curl --fail-with-body --silent --show-error \
  --request POST \
  --header "apikey: ${service_role_key}" \
  --header "authorization: Bearer ${service_role_key}" \
  --header "content-type: application/json" \
  --data "$payload" \
  "${supabase_url}/rest/v1/rpc/configure_byus_queue_maintenance"

echo
