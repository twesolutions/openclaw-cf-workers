# Isolated SopsUtil OpenClaw deployment

This additive deployment leaves the original template and existing Cloudflare SOC resources alone.

- Worker `sopsutil-openclaw-dev`, account `6eef883dec740547667d5a2522924a3b`.
- Canonical browser address: `https://sopsbot.tweai.dev`, a Worker Custom Domain. The original `sopsutil-openclaw-dev.twe-technology-solutions.workers.dev` remains a protected GET/HEAD redirect preserving browser paths and queries, and retains the exact signed Teams callback below. It never proxies legacy browser/API traffic to the Gateway.
- One named Durable Object, `sopsutil-development`, class `SopsutilContainer`.
- Official OpenClaw 2026.11.1 amd64 Docker Hub image pinned by digest `sha256:c504dec53e7f7ad588624e782db1643e1971410a23c99ccbdbb2e0c7a79324cf` (release commit `4ffdd2047d192dd65554de3c8c46c0e0197c6e2a`). The image supplies Node.js 24.22.1; latest OpenClaw requires Node 24.16+ on the 24.x line or Node 26.1+.
- GitHub CLI 2.100.0 is installed into `/home/node/.local/bin` before Gateway startup and added to inherited PATH. The official Linux amd64 release archive is verified against its published checksum; its extracted binary is stored privately at `bootstrap/gh-2.100.0-linux-amd64` and SHA-256 checked by the runtime on every cold start. This keeps the executable outside state archives and restores it after ephemeral disk loss. No GitHub authentication is bundled. Missing/corrupt binary prevents startup; upload and verify it before deploying this runtime.
- `standard-2`: 1 vCPU, 6 GiB memory, 12 GB ephemeral disk.
- Browser/API ingress requires the hostname-based Cloudflare Access application `ebc86b9c-5c57-4d28-865c-b0820d9d6b65`: only John and Araceli's Microsoft identities AND the TWE Gateway posture `9833dad3-0c74-47e9-8004-5ca72dc89784`. Merely being in the datacenter or using consumer WARP grants no access. The Worker validates native `ctx.access.aud`, not client-supplied identity headers. Keep this application's policies narrowly scoped; changing its allowlist changes Worker authority. Gateway password authentication and browser device pairing remain enabled. The Worker replaces forwarded-client headers; Gateway trusts only the observed container ingress peer `10.1.0.0` in addition to any previously configured proxies.
- Version previews are disabled and the Worker rejects alternate origins. Keep both canonical and legacy hostnames in the same narrow hostname-based Access application and in the applicable One Client split-tunnel includes; legacy browser redirects require the same native Access audience. Use hostname-based Access, not Worker-level Access, which currently breaks WebSockets. No public restart route exists.
- The exact legacy `POST https://sopsutil-openclaw-dev.twe-technology-solutions.workers.dev/api/messages` webhook retains separate Microsoft Bot Framework token validation on port 3978, behind path-specific Access application `79edb74f-e455-4d6b-a928-20afe672397f`. Its Access bypass is not a browser or Gateway API exception and does not extend to the new canonical hostname. Missing Bearer, other methods, query strings, non-JSON and oversized declared bodies are rejected at the Worker before container startup. Leave Microsoft's registered webhook address unchanged.
- Private R2 bucket `sopsutil-openclaw-dev-data`. No public bucket.
- Runtime receives the Gateway password, the existing Teams certificate, and a dedicated Workers AI Read-only inference token. It does NOT receive the Cloudflare management token or R2 credentials. Container-only outbound interception accesses narrowly defined R2 objects and the checked-in model catalog through Worker bindings.
- Git/SQLite/config live on local disk. Native verified OpenClaw archives are uploaded every five minutes and before idle shutdown. Restore runs before the Gateway. Failed backup prevents deliberate idle shutdown. Unexpected termination can lose up to the last successful backup; this is not synchronous durable storage.
- Routine checkpoints use the private container-only `/checkpoint-native` outbound binding to invoke native verified archive creation, then stream the exact file through the container API into R2 with a SHA-256 checksum and size/digest metadata readback. This path does not buffer archive bytes in the Worker and has no 90 MiB limit; a 2 GiB archive guard remains. Only after successful upload/readback is that invocation's local archive removed. Routine checkpoints replace `backups/latest.tar.gz` only; account-authorized maintenance checkpoints also retain an immutable `backups/verified-*.tar.gz` recovery copy by default. The legacy buffered PUT endpoint remains limited to 90 MiB for older runtimes and is not used by this runtime. Validate actual archive size, duration and restore behavior before sustained development; abrupt-loss recovery and sustained development capacity are not yet proven.
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
node --test test/sopsutil-checkpoint.test.mjs test/sopsutil-runtime-checkpoint.test.mjs
node --test test/sopsutil-runtime-upgrade.test.mjs test/sopsutil-models.test.mjs test/sopsutil-runtime-models.test.mjs test/sopsutil-model-transport.test.mjs
npx tsc --noEmit --project deploy/sopsutil/tsconfig.json
node --check src/sopsutil/runtime.mjs
npx wrangler deploy --config deploy/sopsutil/wrangler.jsonc --dry-run
npx wrangler deploy --config deploy/sopsutil/wrangler.jsonc
```

Verify anonymous/forged-context denial, One Client off denial, allowed Microsoft-user access with the TWE One Client on, WebSockets, unsigned Teams denial, actual JSON health responses, password/device pairing, source/knowledge presence, backups, and a real model response before declaring end-to-end development readiness. A successful Worker upload alone is not deployment completion. Reconnect One Client to receive updated split-tunnel hostname includes. Preserve existing profile match, precedence, private routes, and fallback domains.

### Runtime image upgrades

Before changing the image, obtain a successful verified checkpoint and preserve an immutable copy of that exact R2 archive, its digest and the old image pin. Never restart to work around a failing checkpoint: active workspace installs/builds must finish or otherwise be reconciled first. Keep the same resources, mounts, environment and access policy.

Account-only Durable Object RPC `setMaintenancePaused(true)` persists a bounded public-start gate while replacing the image. Authorized browser requests and signed Teams callbacks return only `503 {"ok":false,"error":"upgrade_in_progress"}` before any container startup; existing Access/signature denials remain unchanged. Private maintenance/bootstrap probes bypass this public gate. Deploy compatible Worker code without a container rollout first, pause public starts, checkpoint/stop safely, replace the image, verify private startup and model/backup state, then explicitly `setMaintenancePaused(false)`. There is no public pause/unpause route.

The Worker replaces the official image entrypoint, so bootstrap explicitly runs `doctor --fix --non-interactive` after archive restore when no matching completion receipt exists or a Teams migration recovery record remains. It temporarily disables the restored older Teams plugin without discarding its configuration, migrates core state, then installs or verifies trusted official `@openclaw/msteams@2026.11.1`. A private mode-0600 `.bootstrap/teams-pre-migration-2026.11.1.json` recovery record preserves the original Teams fields across a failed-boot retry. After restoring Teams configuration and applying the existing security/model settings, it runs Doctor again with the current plugin enabled and validates configuration. Only after both Doctor passes, configuration validation, callback-route verification and recovery-record cleanup succeed does it write mode-0600 `.bootstrap/native-migration-complete.json`, recording the actual `/app/package.json` runtime version and pinned Teams version. Restoring that receipt with both versions unchanged and no pending recovery record skips both Doctor passes; native Teams provenance/dependency verification (including reinstall when required), security/model settings, final configuration validation and callback-route verification still run before Gateway startup. Missing, malformed or version-mismatched receipts take the full migration path. A refused migration or untrusted/mismatched plugin prevents startup; never fabricate a receipt or delete schema markers, locks or retained migration originals to bypass refusal.

Native backups omit installed plugin `node_modules`; the versioned bootstrap marker is accepted only with current native install/provenance inspection. Doctor may retain pre-migration SQLite backups and update captures that increase checkpoint size. Verify successful native streaming checkpoints after upgrade within the 2 GiB guard. Preserve original histories, browser devices, workspace changes and both configured Cloudflare providers; confirm a real GPT-6.1 Sol response before claiming successful model delivery. A runtime upgrade does not repair an underlying provider auth/billing failure.

An image downgrade does not reverse database or configuration migrations. Rollback must restore the full verified pre-upgrade archive together with its matching old image, with all writers stopped, rather than mixing state generations. Current official guidance: [container upgrades](https://github.com/openclaw/openclaw/blob/v2026.11.1/docs/install/docker.md#upgrading-container-images), [old-version bridges](https://github.com/openclaw/openclaw/blob/v2026.11.1/docs/install/updating.md#upgrading-very-old-versions), and [downgrade recovery](https://github.com/openclaw/openclaw/blob/v2026.11.1/docs/install/updating/rollback-and-recovery.md#downgrade). September 2026 installations do not generally need the pre-July bridge; a detected retired same-file memory index still requires the documented 2026.9.7 compatible-copy migration.

Cold-start readiness allows 15 minutes: the actual archived-state rehearsal required about eight minutes of serial native restore, core migration, matching Teams installation, enabled-plugin migration and validation before Gateway launch. This is a readiness budget, not a diagnosis of the earlier SIGTERM interruptions. Private maintenance callers must allow at least the same window.

## Cloudflare model access

`SOPSUTIL_CF_AI_TOKEN` is a protected Worker secret containing an account-scoped
**Workers AI Read** token, not the operator's management token. The runtime receives
it as `CLOUDFLARE_AI_API_TOKEN`; OpenClaw configuration contains only its environment
SecretRef. Requests use the existing `default` AI Gateway and the unified Cloudflare
`/accounts/<account>/ai/v1` endpoint. No direct upstream API key is needed.

`models.json` is the reviewed catalog source of truth: all current standard
language models from Cloudflare's third-party and hosted catalogs, using their
native Responses, Messages, or Chat Completions adapters. Image/audio/video,
moderation, and structured-decision-only endpoints are not chatbot selections.
The current Cloudflare inventory is 114 models. For an unset selection, the
bootstrap default is hosted GLM 5.3 through `cloudflare-workers` (postpaid Neurons),
with no fallback. Third-party Cloudflare entries remain explicitly labeled prepaid.

The catalog uses `models.mode: "merge"`, allowing native authenticated providers
such as Anthropic and OpenAI Codex alongside Cloudflare. Bootstrap merges only
managed Cloudflare provider definitions, preserves user provider/auth configuration,
existing default and per-agent selections, and existing aliases/settings. The only
preference rewrite is the legacy hosted prefix `cloudflare/@cf/` to the isolated
postpaid `cloudflare-workers/@cf/` route. Existing session overrides are not changed.

Model selection is unrestricted as explicitly requested. The live repair sets
empty default and per-agent model policies. Bootstrap creates an explicit empty
default policy when absent, so the Cloudflare alias map never becomes an implicit
allowlist. It preserves any future policy deliberately authored by the user.
This permits native catalog discovery but does not create credentials or prove a
provider login succeeded. After an authorized policy/config change, use the native
model picker **Refresh** or `models.list` with `refresh: true`; model and policy
configuration supports hot reload. Do not reset
authentication or restart the container merely to refresh a catalog. Verify native
catalog rows and a strict no-delivery provider response separately.
To refresh the catalog, read `/ai/catalog/models` (paginated) and `/ai/models/search`
with an authorized operator credential, then run:

```sh
node scripts/build-sopsutil-models.mjs external.json workers.json deploy/sopsutil/models.json
node --test test/sopsutil-models.test.mjs test/sopsutil-runtime-models.test.mjs
```

Deploy the exact reviewed source, checkpoint before restart, verify native provider
probe and a no-delivery bot response, checkpoint and restore normal startup, then
verify pairing, UI, health, and anonymous-tools denial. Model selection and managed
inference do not authorize purchasing credits, enabling top-up, or changing plans.

