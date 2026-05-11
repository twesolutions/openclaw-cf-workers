#!/bin/sh
set -e

mkdir -p /root/.openclaw

R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
echo "Mounting R2 bucket ${R2_BUCKET_NAME} at /root/.openclaw..."
/usr/local/bin/tigrisfs --endpoint "${R2_ENDPOINT}" -f "${R2_BUCKET_NAME}" /root/.openclaw &

sleep 3

# R2 object storage cannot represent symlinks, but openclaw stores
# plugin-skills as symlinks pointing into plugins/. tigrisfs silently
# turns each symlink write into an empty regular file, then openclaw's
# readlink() fails with EINVAL. Back plugin-skills with local ephemeral
# disk so symlinks work; openclaw re-creates them from plugins/ on start.
echo "Setting up local-disk plugin-skills (R2 cannot represent symlinks)..."
mkdir -p /root/.openclaw/plugin-skills
find /root/.openclaw/plugin-skills -maxdepth 1 -type f -empty -delete 2>/dev/null || true
mkdir -p /var/lib/openclaw-plugin-skills
mount --bind /var/lib/openclaw-plugin-skills /root/.openclaw/plugin-skills \
    || echo "WARNING: bind mount for plugin-skills failed; plugins relying on symlinks will error"

exec openclaw gateway --port 18789 --bind lan --allow-unconfigured
