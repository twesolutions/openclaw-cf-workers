# Isolated SopsUtil OpenClaw deployment

This additive deployment leaves the original template and existing Cloudflare SOC resources alone.

- Worker `sopsutil-openclaw-dev`, account `6eef883dec740547667d5a2522924a3b`.
- Canonical browser address: `https://sopsbot.tweai.dev`, a Worker Custom Domain. The original `sopsutil-openclaw-dev.twe-technology-solutions.workers.dev` remains a protected GET/HEAD redirect preserving browser paths and queries, and retains the exact signed Teams callback below. It never proxies legacy browser/API traffic to the Gateway.
- One named Durable Object, `sopsutil-development`, class `SopsutilContainer`.
- Official OpenClaw 2026.9.3 amd64 Docker Hub image pinned by digest.
- GitHub CLI 2.100.0 is installed into `/home/node/.local/bin` before Gateway startup and added to inherited PATH. The official Linux amd64 release archive is verified against its published checksum; its extracted binary is stored privately at `bootstrap/gh-2.100.0-linux-amd64` and SHA-256 checked by the runtime on every cold start. This keeps the executable outside state archives and restores it after ephemeral disk loss. No GitHub authentication is bundled. Missing/corrupt binary prevents startup; upload and verify it before deploying this runtime.
- `standard-2`: 1 vCPU, 6 GiB memory, 12 GB ephemeral disk.
- Browser/API ingress requires the hostname-based Cloudflare Access application `ebc86b9c-5c57-4d28-865c-b0820d9d6b65`: only John and Araceli's Microsoft identities AND the TWE Gateway posture `9833dad3-0c74-47e9-8004-5ca72dc89784`. Merely being in the datacenter or using consumer WARP grants no access. The Worker validates native `ctx.access.aud`, not client-supplied identity headers. Keep this application's policies narrowly scoped; changing its allowlist changes Worker authority. Gateway password authentication and browser device pairing remain enabled. The Worker replaces forwarded-client headers; Gateway trusts only the observed container ingress peer `10.1.0.0` in addition to any previously configured proxies.
- Version previews are disabled and the Worker rejects alternate origins. Keep both canonical and legacy hostnames in the same narrow hostname-based Access application and in the applicable One Client split-tunnel includes; legacy browser redirects require the same native Access audience. Use hostname-based Access, not Worker-level Access, which currently breaks WebSockets. No public restart route exists.
- The exact legacy `POST https://sopsutil-openclaw-dev.twe-technology-solutions.workers.dev/api/messages` webhook retains separate Microsoft Bot Framework token validation on port 3978, behind path-specific Access application `79edb74f-e455-4d6b-a928-20afe672397f`. Its Access bypass is not a browser or Gateway API exception and does not extend to the new canonical hostname. Missing Bearer, other methods, query strings, non-JSON and oversized declared bodies are rejected at the Worker before container startup. Leave Microsoft's registered webhook address unchanged.
- Private R2 bucket `sopsutil-openclaw-dev-data`. No public bucket.
- Runtime receives the Gateway password only. It does NOT receive the Cloudflare account token or R2 credentials. Container-only outbound interception accesses the narrowly defined R2 objects through Worker bindings.
- Git/SQLite/config live on local disk. Native verified OpenClaw archives are uploaded every five minutes and before idle shutdown. Restore runs before the Gateway. Failed backup prevents deliberate idle shutdown. Unexpected termination can lose up to the last successful backup; this is not synchronous durable storage.
- Backup object size limit is 90 MiB. Node modules and build outputs can exhaust that limit; validate the actual archive behavior before sustained development. Verified native archive creation/upload and a checkpoint-protected container restart on 2026-09-11; abrupt-loss recovery and sustained development capacity are not yet proven.
- Runtime internal service on 18790 is never publicly routed; only 18789 is proxied. It exposes bounded status, checkpoint and device-list operations for deployment diagnostics.
- Cloudflare-account-authorized SSH remains enabled for device approval and recovery; no SSH private key is baked in.

## Private bootstrap

Provision `bootstrap/seed.json` and `bootstrap/source.bundle` privately in the bucket. Neither belongs in this public repository. Seed files are written only if absent; existing workspace edits are preserved. Bundle initializes the private app checkout, then its remote is reset to the real GitHub URL. No GitHub credential is included. Configure GitHub and a model independently through secure OpenClaw setup.

Worker secret `SOPSUTIL_CF_GATEWAY_PASSWORD` supplies Gateway `OPENCLAW_GATEWAY_PASSWORD` via an environment SecretRef. Never put the password in configuration JSON or command arguments. Before this secret exists the Worker responds 503 and does not start a container.

When moving the browser hostname or rotating this secret, preserve and checkpoint the running container first, then restart through the account-authorized container management path after the new Worker configuration/secret is deployed. A running container retains its existing environment until restart. The normal runtime bootstrap consumes `PUBLIC_ORIGIN=https://sopsbot.tweai.dev` to rebuild the Gateway's control UI allowed origins and resolves the current password SecretRef. Verify successful checkpoint, restored state, canonical-origin WebSocket access and password/device pairing. Do not add a public restart endpoint or expose the password in tests, logs or shell arguments.

## Checks and deploy

```
npm ci
node --test test/sopsutil-access.test.mjs
npx tsc --noEmit --project deploy/sopsutil/tsconfig.json
node --check src/sopsutil/runtime.mjs
npx wrangler deploy --config deploy/sopsutil/wrangler.jsonc --dry-run
npx wrangler deploy --config deploy/sopsutil/wrangler.jsonc
```

Verify anonymous/forged-context denial, One Client off denial, allowed Microsoft-user access with the TWE One Client on, WebSockets, unsigned Teams denial, actual JSON health responses, password/device pairing, source/knowledge presence, backups, and a real model response before declaring end-to-end development readiness. A successful Worker upload alone is not deployment completion. Reconnect One Client to receive updated split-tunnel hostname includes. Preserve existing profile match, precedence, private routes, and fallback domains.
