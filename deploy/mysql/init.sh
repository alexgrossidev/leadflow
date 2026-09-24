#!/usr/bin/env bash
# Runs once, on the first start of an empty MySQL volume (docker-entrypoint-initdb.d).
#
# Each service owns its database. Schemas come from the services' own
# migrations/*.sql, applied in lexical order; demo seeds are applied last.
# One application user is shared across databases to keep the demo simple —
# production would give every service its own credentials.
set -euo pipefail

SERVICES_DIR=/leadflow/services
mysql_root() { mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "$@"; }

apply_dir() {
  local db=$1 dir=$2
  for file in $(ls "$dir"/*.sql 2>/dev/null | sort); do
    echo "  ${db} <- ${file#${SERVICES_DIR}/}"
    mysql_root "$db" < "$file"
  done
}

declare -A DATABASES=(
  [gateway]=gateway
  [lead-ingestion]=lead_ingestion
  [automations]=automations
  [sender]=sender
  [whatsapp]=whatsapp
  [agents]=agents
  [fileparser]=fileparser
)

for service in "${!DATABASES[@]}"; do
  db=${DATABASES[$service]}
  echo "Creating database ${db}"
  mysql_root -e "CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
                 GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${MYSQL_USER}'@'%';"
  apply_dir "$db" "${SERVICES_DIR}/${service}/migrations"
done

echo "Seeding demo data"
apply_dir gateway "${SERVICES_DIR}/gateway/migrations/seed"
mysql_root lead_ingestion < "${SERVICES_DIR}/lead-ingestion/scripts/demo-seed.sql"
mysql_root -e "FLUSH PRIVILEGES;"
