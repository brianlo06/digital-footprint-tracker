#!/bin/sh

set -eu

node scripts/verify-cloudflare-deployment-boundaries.mjs

local_env=".env.local"
backup_env=".env.local.cloud-build-backup"

restore_local_env() {
  if [ -f "$backup_env" ]; then
    mv "$backup_env" "$local_env"
  fi
}

trap restore_local_env EXIT HUP INT TERM

if [ -e "$backup_env" ]; then
  echo "Refusing to build while $backup_env already exists." >&2
  exit 1
fi

if [ -f "$local_env" ]; then
  mv "$local_env" "$backup_env"
fi

npx opennextjs-cloudflare build "$@"
node scripts/verify-cloudflare-build-env.mjs
