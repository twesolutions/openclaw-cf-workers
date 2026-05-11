#!/bin/sh
set -e

mkdir -p /root/.openclaw

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
echo "Mounting R2 bucket ${R2_BUCKET_NAME} at /root/.openclaw..."
/usr/local/bin/tigrisfs --endpoint "${R2_ENDPOINT}" -f "${R2_BUCKET_NAME}" /root/.openclaw &

sleep 3

exec openclaw gateway --port 18789 --bind lan --allow-unconfigured
