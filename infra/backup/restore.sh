#!/usr/bin/env sh
# Restore a backup into a NEW, EMPTY database, then re-apply roles/grants/RLS with the migrator.
# Never restores over an existing database: create the target first and point TARGET_OWNER_URL at it.
# Usage: TARGET_OWNER_URL=postgres://owner:pw@host:5432/platform_restore APP_DB_PASSWORD=... ./restore.sh <file.dump>
set -eu
FILE="${1:?usage: restore.sh <file.dump>}"
: "${TARGET_OWNER_URL:?TARGET_OWNER_URL is required}"
if [ -f "$FILE.sha256" ]; then (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256"); fi
COUNT=$(psql "$TARGET_OWNER_URL" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$COUNT" != "0" ]; then echo "target database is not empty ($COUNT tables) — refusing to restore" >&2; exit 1; fi
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_OWNER_URL" "$FILE"
echo "restored; now run migrations against the target to (re)create app_user, grants and RLS:"
echo "  DATABASE_OWNER_URL=\$TARGET_OWNER_URL APP_DB_PASSWORD=... node dist/migrate.js   (worker image)"
