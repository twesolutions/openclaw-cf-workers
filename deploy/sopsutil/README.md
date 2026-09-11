# Isolated SopsUtil OpenClaw deployment

This additive deployment leaves the original template and existing Cloudflare SOC resources alone.

- Worker `sopsutil-openclaw-dev`, account `6eef883dec740547667d5a2522924a3b`.
- One named Durable Object, `sopsutil-development`, class `SopsutilContainer`.
- Official OpenClaw 2026.9.3 amd64 Docker Hub image pinned by digest.
- `standard-2`: 1 vCPU, 6 GiB memory, 12 GB ephemeral disk.
- Source ingress restricted to the approved datacenter `63.251.196.0/24`; Gateway password authentication and browser device pairing remain enabled. The Worker replaces forwarded-client headers; Gateway trusts only the observed container ingress peer `10.1.0.0` in addition to any previously configured proxies.
- Private R2 bucket `sopsutil-openclaw-dev-data`. No public bucket or custom domain.
- Runtime receives the Gateway password only. It does NOT receive the Cloudflare account token or R2 credentials. Container-only outbound interception accesses the narrowly defined R2 objects through Worker bindings.
- Git/SQLite/config live on local disk. Native verified OpenClaw archives are uploaded every five minutes and before idle shutdown. Restore runs before the Gateway. Failed backup prevents deliberate idle shutdown. Unexpected termination can lose up to the last successful backup; this is not synchronous durable storage.
- Backup object size limit is 90 MiB. Node modules and build outputs can exhaust that limit; validate the actual archive behavior before sustained development. Verified native archive creation/upload and a checkpoint-protected container restart on 2026-09-11; abrupt-loss recovery and sustained development capacity are not yet proven.
- Runtime internal service on 18790 is never publicly routed; only 18789 is proxied. It exposes bounded status, checkpoint and device-list operations for deployment diagnostics.
- Cloudflare-account-authorized SSH remains enabled for device approval and recovery; no SSH private key is baked in.

## Private bootstrap

Provision `bootstrap/seed.json` and `bootstrap/source.bundle` privately in the bucket. Neither belongs in this public repository. Seed files are written only if absent; existing workspace edits are preserved. Bundle initializes the private app checkout, then its remote is reset to the real GitHub URL. No GitHub credential is included. Configure GitHub and a model independently through secure OpenClaw setup.

Worker secret `SOPSUTIL_CF_GATEWAY_PASSWORD` supplies Gateway `OPENCLAW_GATEWAY_PASSWORD` via an environment SecretRef. Never put the password in configuration JSON or command arguments. Before this secret exists the Worker responds 503 and does not start a container.

## Checks and deploy

```
npm ci
npx tsc --noEmit --project deploy/sopsutil/tsconfig.json
node --check src/sopsutil/runtime.mjs
npx wrangler deploy --config deploy/sopsutil/wrangler.jsonc --dry-run
npx wrangler deploy --config deploy/sopsutil/wrangler.jsonc
```

Verify unauthenticated API denial and outside-datacenter denial, actual JSON health responses, password/device pairing, source/knowledge presence, backup object creation, clean shutdown and restore, and a real model response before declaring development readiness. A successful Worker upload alone is not deployment completion.
