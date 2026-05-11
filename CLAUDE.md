# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`openclaw` is a Cloudflare Containers project — a Worker that routes requests to one or more Docker containers running on Cloudflare's edge network. Containers are backed by Durable Objects and managed via `@cloudflare/containers`.

The container runs the openclaw gateway (`ghcr.io/openclaw/openclaw:latest`) with:
- **R2 persistent storage** — the `~/.openclaw` config directory is mounted from the `openclaw-data` R2 bucket via tigrisfs (FUSE)
- **SSH access** — enabled via `wrangler containers ssh` using the `~/.ssh/id_ed25519` key

## Prerequisites

- Docker must be running locally before any deploy (`docker info` to verify)
- Wrangler CLI (`npx wrangler ...` or install globally)
- Cloudflare account with Containers beta enabled
- Docker credential store must not require macOS Keychain interaction — see [Docker credential helper](#docker-credential-helper) below

## Deployed URLs

- **Worker**: https://openclaw.your-account-subdomain.workers.dev
- **Account subdomain**: `your-account-subdomain` (used to construct `*.your-account-subdomain.workers.dev`)
- **Cloudflare account ID**: `your-cloudflare-account-id`

## Common Commands

```bash
# Local development (Worker only; containers are not fully emulated locally)
npx wrangler dev

# Build Docker image, push to Cloudflare registry, and deploy Worker
npx wrangler deploy

# Check container state (running/healthy/degraded/provisioning)
npx wrangler containers list

# List running instances and get instance IDs
npx wrangler containers instances APPLICATION_ID_PLACEHOLDER

# SSH into a running container instance
npx wrangler containers ssh <INSTANCE_ID>

# Run a single command in the container without opening a shell
npx wrangler containers ssh <INSTANCE_ID> -- <command>

# Tail Worker logs in real time
npx wrangler tail --format=pretty

# Hit the worker to verify it's up (cold start takes ~10-15s with R2 mount)
curl -m 35 -w "\nHTTP %{http_code} in %{time_total}s\n" https://openclaw.your-account-subdomain.workers.dev/

# List R2 buckets
npx wrangler r2 bucket list

# Force container restart by killing the openclaw process. Cloudflare's
# health checks fail when /ping stops responding and the runtime spawns
# a fresh container (same instance ID — DO ID is deterministic).
# Do NOT use `kill -9 1` against systemd — Cloudflare's container runtime
# silently filters SIGKILL on PID 1; the call returns 0 but does nothing.
npx wrangler containers ssh <INSTANCE_ID> -- pkill -9 openclaw
```

## Security

### IP Allowlist

The Worker enforces an IP allowlist before forwarding any request to the container. Requests from unlisted IPs receive HTTP 403. The allowlist is a `Set` in `src/index.ts`:

```ts
const ALLOWED_IPS = new Set(["YOUR.PUBLIC.IP.HERE"]);
```

To add or remove IPs, edit `ALLOWED_IPS` and run `npx wrangler deploy`. The `CF-Connecting-IP` header is set by Cloudflare and cannot be spoofed by callers.

## Architecture

Cloudflare Containers has two layers:

1. **Worker** (`src/index.ts`) — handles incoming HTTP requests, enforces the IP allowlist, and routes allowed requests to container instances using `getContainer()` from `@cloudflare/containers`.
2. **Container class** (`OpenclawContainer`) — extends `Container` from `@cloudflare/containers`, backed by a Durable Object. Sets `envVars` to forward R2 credentials into the container process.

### Startup sequence

The container runs `startup.sh` on start:
1. Creates `/root/.openclaw` directory
2. Mounts the `openclaw-data` R2 bucket at `/root/.openclaw` via tigrisfs (FUSE)
3. Waits 3 seconds for the mount to be ready
4. Starts the openclaw gateway on port 18789

Configuration written to `/root/.openclaw` inside the container is automatically persisted to R2 and survives restarts and redeployments.

**Exception — `/root/.openclaw/plugin-skills/`:** R2 is object storage and cannot represent POSIX symlinks. tigrisfs silently turns each `symlink()` write into a zero-byte regular file, which then causes openclaw's `readlink()` calls to fail with `EINVAL: invalid argument` and plugins to refuse to load. `startup.sh` works around this by bind-mounting a local ephemeral directory (`/var/lib/openclaw-plugin-skills`) over `/root/.openclaw/plugin-skills`, so symlinks work normally. The directory is ephemeral, but openclaw rebuilds the symlinks from the persistent `plugins/` directory on startup, so this is fine. **Do not add any other path under `~/.openclaw` that openclaw expects to contain symlinks without applying the same bind-mount treatment.**

### Configuration (`wrangler.jsonc`)

```jsonc
{
  "name": "openclaw",
  "main": "src/index.ts",
  "containers": [
    {
      "class_name": "OpenclawContainer",
      "image": "./Dockerfile",
      "max_instances": 1,
      "instance_type": {       // custom type — must have ≥1 vCPU, ≥3 GiB per vCPU
        "vcpu": 1,
        "memory_mib": 3072
      },
      "ssh": { "enabled": true },
      "authorized_keys": [
        { "name": "aaron", "public_key": "ssh-ed25519 AAAAC3..." }
      ]
    }
  ],
  "vars": {
    "R2_ACCOUNT_ID": "your-cloudflare-account-id",
    "R2_BUCKET_NAME": "openclaw-data"
  }
  // R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are Worker secrets (wrangler secret put)
}
```

### Instance types

Pre-set types:

| Type       | vCPU  | RAM     | Disk  |
| ---------- | ----- | ------- | ----- |
| lite       | 1/16  | 256 MiB | 2 GB  |
| basic      | 1/4   | 1 GiB   | 4 GB  |
| standard-1 | 1/2   | 4 GiB   | 8 GB  |
| standard-2 | 1     | 6 GiB   | 12 GB |

Custom types (`instance_type: { vcpu, memory_mib }`) are also supported with these constraints:
- vCPU must be ≥ 1 (fractions like 0.5 are rejected)
- Memory must be ≥ 3 GiB per vCPU (e.g. 1 vCPU → ≥ 3072 MiB)
- `disk_mib` is not a valid field and is silently ignored — disk defaults to ~2 GB

This project uses a custom type: 1 vCPU, 3 GiB RAM. The openclaw gateway requires at least `basic` (256 MiB is not enough).

### Worker code pattern (with envVars and keep-alive)

```ts
import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  OPENCLAW_CONTAINER: DurableObjectNamespace;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
}

export class OpenclawContainer extends Container<Env> {
  defaultPort = 18789;
  envVars = {
    R2_ACCOUNT_ID: this.env.R2_ACCOUNT_ID,
    R2_BUCKET_NAME: this.env.R2_BUCKET_NAME,
    AWS_ACCESS_KEY_ID: this.env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: this.env.R2_SECRET_ACCESS_KEY,
  };

  async onActivityExpired() {
    // keep alive — do not stop the container on idle
  }
}
```

`envVars` is a class field (not a getter) initialized after `super()`, so `this.env` is available.

`onActivityExpired()` is normally called when the `sleepAfter` inactivity timeout expires, and by default calls `this.stop()`. Overriding it with an empty body keeps the container running indefinitely. This is the Containers equivalent of `keepAlive: true` in the Cloudflare Sandboxes product (different API — don't confuse the two). Call `this.stop()` or `this.destroy()` explicitly when you need to shut down.

## R2 Persistent Storage

`~/.openclaw` inside the container is mounted from the `openclaw-data` R2 bucket via tigrisfs (FUSE). This persists openclaw configuration (API providers, Telegram channel, etc.) across container restarts.

### R2 credentials

Three values are shown when creating an R2 API token:
- **Token value** — for Cloudflare REST API auth. **Not used here.**
- **Access Key ID** → stored as Worker secret `R2_ACCESS_KEY_ID`
- **Secret Access Key** → stored as Worker secret `R2_SECRET_ACCESS_KEY`

Use an **Account API token** (not User API token) scoped to the `openclaw-data` bucket with Object Read & Write permission. Do not add IP address restrictions — Cloudflare containers have dynamic IPs.

To update secrets:
```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

### Verifying the mount

```bash
# Should show a FUSE/tigrisfs filesystem, not /dev/vdc (root fs)
npx wrangler containers ssh <INSTANCE_ID> -- df -h /root/.openclaw

# Check tigrisfs is running
npx wrangler containers ssh <INSTANCE_ID> -- ps aux | grep tigrisfs

# Test mount manually (uses env vars already set in container)
npx wrangler containers ssh <INSTANCE_ID> -- \
  /usr/local/bin/tigrisfs --endpoint "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" \
  -f openclaw-data /tmp/testmount
```

## SSH Access

SSH is enabled via `wrangler containers ssh`. Only `ssh-ed25519` keys are supported. The authorized key is `~/.ssh/id_ed25519.pub` on the local machine.

```bash
# Step 1: get the application ID
npx wrangler containers list

# Step 2: get the instance ID (pass the application ID)
npx wrangler containers instances <APPLICATION_ID>

# Step 3: SSH in
npx wrangler containers ssh <INSTANCE_ID>
```

The user inside the container is `root`.

### Critical gotcha: never delete and recreate with the same DO class name

If you `wrangler containers delete <ID>` and then `wrangler deploy` to recreate, `wrangler containers ssh` will fail forever with `Instance <ID> not found` (the Cloudflare API returns `DEPLOYMENT_NOT_FOUND` from `GET /containers/instances/{DO_ID}/ssh`). Updates (`wrangler deploy` over an existing app) are fine — only delete-then-create triggers this. To restart the container without losing SSH, push any Dockerfile change instead of deleting.

**Root cause:** The instance ID shown by `wrangler containers instances` is the Durable Object ID, which is deterministic from the DO namespace (one namespace per `class_name` per Worker). Cloudflare's SSH proxy backend caches a mapping from DO ID → deployment UUID and **does not invalidate it when the application is deleted**. Recreating the app with the same DO class produces the same DO ID, which still resolves to the now-dead deployment.

**Recovery** (if it has already broken):

1. Rename the DO class in `src/index.ts` (e.g. `OpenclawContainerV2`).
2. Update `class_name` in the binding *and* the migrations in `wrangler.jsonc`. The cleanest recovery is to delete the whole Worker (`npx wrangler delete --name openclaw`) and redeploy — that lets you collapse migrations to a single `new_sqlite_classes` entry for the new class. A `deleted_classes` migration against a live binding fails with `code 10061`.
3. `npx wrangler deploy` — note the new `namespace_id` in the diff (should differ from the old one), confirming a fresh DO namespace.
4. **Re-add Worker secrets.** `wrangler delete --name openclaw` also wipes all Worker secrets, so `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` will be missing from the new deployment. The container will start with `AWS_ACCESS_KEY_ID=undefined`, tigrisfs will fail to authenticate, and `/root/.openclaw` will be backed by ephemeral disk instead of R2. After running both `wrangler secret put` commands, force a container restart with `pkill -9 openclaw` (above) so the new envVars are picked up — the running container does not re-read secrets in place.

R2-backed config (`~/.openclaw`) survives all of this since it lives in the `openclaw-data` bucket, not in the DO or the Worker.

## Pricing (custom 1 vCPU / 3 GiB, always-on)

Based on Workers Paid plan ($5/month required):

| Resource | Included free | Rate after |
|---|---|---|
| Memory | 25 GiB-hours/month | $0.0000025/GiB-second |
| vCPU | 375 vCPU-minutes/month | $0.000020/vCPU-second |
| Disk | 200 GB-hours/month | $0.00000007/GB-second |

This project uses `onActivityExpired()` to keep the container alive indefinitely (no sleeping). Cost runs continuously:
- Memory (3 GiB) at ~$0.027/hour after free tier (~9 free hours/month)
- vCPU (1 core) at ~$1.20/hour — but only billed during actual compute, not idle; stays within free tier for light use
- **Estimated: ~$15–20/month** always-on at 3 GiB RAM

To re-enable sleep (cheaper), remove `onActivityExpired()` and add `sleepAfter = "15m"` to the class. Memory is only billed while awake.

## Deployment Notes

- First deploy is slow: Docker image must be built and pushed to Cloudflare's registry.
- After the first deploy, wait several minutes for containers to be provisioned before they accept traffic.
- Subsequent deploys reuse Docker layer cache and are significantly faster.
- Docker Hub images can be used directly via `"image": "docker.io/<namespace>/<repo>:<tag>"` instead of a local Dockerfile.
- **GHCR images** (`ghcr.io/...`) are not supported directly in the `image` field. Workaround: use a one-line `Dockerfile` with `FROM ghcr.io/<org>/<image>:<tag>` and set `"image": "./Dockerfile"`. Wrangler will build it locally and push to Cloudflare's registry.
- If an image only binds to `127.0.0.1` by default (e.g. openclaw gateway), override `CMD` in the Dockerfile to force LAN binding so Cloudflare's sidecar proxy can reach the process.
- **Apple Silicon (arm64) gotcha**: Cloudflare runs `linux/amd64`. If the base image is multi-arch, Docker on an arm64 Mac will build and push an arm64 image by default, which silently fails on Cloudflare (container stays in degraded/provisioning state forever). Always pin the platform: `FROM --platform=linux/amd64 ghcr.io/...`.
- **Non-root base images**: If the base image runs as a non-root user, `apt-get` will fail with permission denied. Add `USER root` before any `RUN` install steps in the Dockerfile.
- **Script permissions**: Files created and `COPY`'d into a Docker image may not be executable. Always add `RUN chmod +x /script.sh` after copying scripts.

## Troubleshooting

### Container stuck in `degraded` or `provisioning` with 503 after ~28 seconds

The 28-second timeout is the signature of a container that never passes its startup health check:
- `instanceGetTimeoutMS` = 8s (time to provision the container instance)
- `portReadyTimeoutMS` = 20s (time for the port to start accepting connections)
- Total = 28s → 503 "There is no Container instance available at this time"

**Most likely cause: OOM kill.** The default `instance_type: "lite"` has only 256 MiB RAM. Fix: use `"instance_type": "basic"` or higher, or a custom type with at least 1 GiB.

**Other causes to rule out:**
1. **Architecture mismatch** — Cloudflare runs `linux/amd64`. Verify Dockerfile has `FROM --platform=linux/amd64 ...`.
2. **Port not binding** — Test locally: `docker run --rm -p 18789:18789 <image> <cmd>` then `curl http://localhost:18789/ping`. Should return HTTP 200 within 2 seconds.
3. **Image not updated** — Wrangler caches aggressively. If `wrangler containers list --json` shows an old image sha, clear Docker build cache (`docker builder prune -f`) and redeploy.
4. **Startup script not executable** — Add `RUN chmod +x /startup.sh` in Dockerfile after COPY.
5. **tigrisfs mount hanging** — If R2 credentials are wrong or have IP restrictions, tigrisfs fails and (with `set -e`) can prevent openclaw from starting.

### R2 mount not working (tigrisfs 401 Unauthorized)

- Check the R2 API token has **Object Read & Write** permission scoped to the bucket
- Ensure **no IP address restrictions** on the token (container IPs are dynamic)
- Use an **Account API token**, not a User API token
- Verify the correct values: Access Key ID → `R2_ACCESS_KEY_ID`, Secret Access Key → `R2_SECRET_ACCESS_KEY` (the third "Token value" shown by Cloudflare is for REST API auth only)

### `wrangler deploy` says "no changes" but container is still broken

The image sha in Cloudflare's registry matches the local build (cached). Clear the build cache to force a new sha:
```bash
docker builder prune -f
npx wrangler deploy
```

### Health check endpoint

The `@cloudflare/containers` `Container` class pings `GET http://localhost:<defaultPort>/ping` by default (`pingEndpoint = "ping"`). The openclaw gateway responds HTTP 200 on `/ping`, so this is not an issue — but if you add a custom container, verify the endpoint returns 2xx.

## Docker Credential Helper

Docker Desktop's default credential store (`docker-credential-desktop`) uses the macOS Keychain and will fail with `User interaction is not allowed (-25308)` when called from non-interactive processes (including Claude Code).

A file-based credential helper is installed at `~/.local/bin/docker-credential-filecreds` and `~/.docker/config.json` is configured to use it (`"credsStore": "filecreds"`). Credentials are stored in plaintext at `~/.docker/file-credentials.json`.

If this helper is ever lost or the config reverts to `"credsStore": "desktop"`, recreate it:

```python
# ~/.local/bin/docker-credential-filecreds  (chmod +x)
#!/usr/bin/env python3
import sys, json, os

CRED_FILE = os.path.expanduser("~/.docker/file-credentials.json")

def load():
    if os.path.exists(CRED_FILE):
        with open(CRED_FILE) as f:
            return json.load(f)
    return {}

def save(data):
    with open(CRED_FILE, "w") as f:
        json.dump(data, f)

cmd = sys.argv[1] if len(sys.argv) > 1 else ""

if cmd == "store":
    entry = json.load(sys.stdin)
    db = load()
    db[entry["ServerURL"]] = {"Username": entry["Username"], "Secret": entry["Secret"]}
    save(db)
elif cmd == "get":
    server = sys.stdin.read().strip()
    db = load()
    entry = db.get(server, {"Username": "", "Secret": ""})
    print(json.dumps(entry))
elif cmd == "erase":
    server = sys.stdin.read().strip()
    db = load()
    db.pop(server, None)
    save(db)
elif cmd == "list":
    db = load()
    print(json.dumps({k: v["Username"] for k, v in db.items()}))
```

Then set `"credsStore": "filecreds"` in `~/.docker/config.json`.
