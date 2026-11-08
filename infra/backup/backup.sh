#!/usr/bin/env sh
# PostgreSQL logical backup (custom format, compressed) with retention.
# Usage (cron / Coolify scheduled task):  DATABASE_OWNER_URL=postgres://... BACKUP_DIR=/backups ./backup.sh
# Object storage (S3) must be backed up with the provider's versioning/replication — not covered here.
set -eu
: "${DATABASE_OWNER_URL:?DATABASE_OWNER_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./infra/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$BACKUP_DIR/platform-$STAMP.dump"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$FILE" "$DATABASE_OWNER_URL"
# integrity check: the archive must list its contents
pg_restore --list "$FILE" > /dev/null
sha256sum "$FILE" > "$FILE.sha256" 2>/dev/null || shasum -a 256 "$FILE" > "$FILE.sha256"
find "$BACKUP_DIR" -name 'platform-*.dump*' -type f -mtime +"$KEEP_DAYS" -delete
echo "backup written: $FILE"
