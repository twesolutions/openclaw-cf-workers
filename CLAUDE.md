# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`openclaw` is a Cloudflare Containers project — a Worker that routes requests to one or more Docker containers running on Cloudflare's edge network. Containers are backed by Durable Objects and managed via `@cloudflare/containers`.

## Prerequisites

- Docker must be running locally before any deploy (`docker info` to verify)
- Wrangler CLI (`npx wrangler ...` or install globally)
- Cloudflare account with Containers beta enabled
- Docker credential store must not require macOS Keychain interaction — see [Docker credential helper](#docker-credential-helper) below

## Deployed URLs

- **Worker**: https://openclaw.your-account-subdomain.workers.dev
- **Account subdomain**: `your-account-subdomain` (used to construct `*.your-account-subdomain.workers.dev`)

## Common Commands

```bash
# Local development (Worker only; containers are not fully emulated locally)
npx wrangler dev

# Build Docker image, push to Cloudflare registry, and deploy Worker
npx wrangler deploy

# Check container state (running/healthy/degraded/provisioning)
npx wrangler containers list

# Same with more detail (image sha, version, timestamps)
npx wrangler containers list --json

# Tail Worker logs in real time
npx wrangler tail --format=pretty

# Hit the worker to verify it's up (cold start takes ~8s)
curl -m 35 -w "\nHTTP %{http_code} in %{time_total}s\n" https://openclaw.your-account-subdomain.workers.dev/
```

## Architecture

Cloudflare Containers has two layers:

1. **Worker** (`src/index.ts` or similar) — handles incoming HTTP requests and routes them to container instances using `getContainer()` from `@cloudflare/containers`.
2. **Container class** — a class extending `Container` (also from `@cloudflare/containers`), which is backed by a Durable Object and wraps the Docker container lifecycle.

### Configuration (`wrangler.jsonc`)

```jsonc
{
  "name": "openclaw",
  "main": "src/index.ts",
  "containers": [
    {
      "class_name": "MyContainer",
      "image": "./Dockerfile",   // or a Docker Hub image reference
      "max_instances": 1,        // use max_instances, not instances (deprecated)
      "instance_type": "basic"   // lite=256MiB (default, too small), basic=1GiB, standard-1=4GiB
    }
  ],
  "durable_objects": {
    "bindings": [{ "class_name": "MyContainer", "name": "MY_CONTAINER" }]
  },
  "migrations": [
    { "new_sqlite_classes": ["MyContainer"], "tag": "v1" }
  ],
  "observability": {
    "enabled": true              // enables container log streaming in Cloudflare dashboard
  }
}
```

### Instance types

| Type       | vCPU  | RAM     | Disk  |
| ---------- | ----- | ------- | ----- |
| lite       | 1/16  | 256 MiB | 2 GB  |
| basic      | 1/4   | 1 GiB   | 4 GB  |
| standard-1 | 1/2   | 4 GiB   | 8 GB  |
| standard-2 | 1     | 6 GiB   | 12 GB |

The openclaw gateway requires at least `basic` (256 MiB is not enough for a Node.js app with 6 plugins).

### Worker code pattern

```ts
import { Container, getContainer } from "@cloudflare/containers";

export class MyContainer extends Container {
  defaultPort = 8080;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const container = getContainer(env.MY_CONTAINER);
    return container.fetch(request);
  },
};
```

## Deployment Notes

- First deploy is slow: Docker image must be built and pushed to Cloudflare's registry.
- After the first deploy, wait several minutes for containers to be provisioned before they accept traffic.
- Subsequent deploys reuse Docker layer cache and are significantly faster.
- Docker Hub images can be used directly via `"image": "docker.io/<namespace>/<repo>:<tag>"` instead of a local Dockerfile.
- **GHCR images** (`ghcr.io/...`) are not supported directly in the `image` field. Workaround: use a one-line `Dockerfile` with `FROM ghcr.io/<org>/<image>:<tag>` and set `"image": "./Dockerfile"`. Wrangler will build it locally and push to Cloudflare's registry.
- If an image only binds to `127.0.0.1` by default (e.g. openclaw gateway), override `CMD` in the Dockerfile to force LAN binding so Cloudflare's sidecar proxy can reach the process.
- **Apple Silicon (arm64) gotcha**: Cloudflare runs `linux/amd64`. If the base image is multi-arch, Docker on an arm64 Mac will build and push an arm64 image by default, which silently fails on Cloudflare (container stays in degraded/provisioning state forever). Always pin the platform: `FROM --platform=linux/amd64 ghcr.io/...`.
- **Instance type**: The default `lite` (256 MiB RAM) is too small for the openclaw gateway with its 6 plugins. Use `instance_type: "basic"` (1 GiB RAM) in `wrangler.jsonc`. OOM kills cause the container to restart-loop, presenting as persistent `degraded`/`provisioning` state and 503 errors after a 28-second wait (= `instanceGetTimeoutMS` 8s + `portReadyTimeoutMS` 20s).

## Troubleshooting

### Container stuck in `degraded` or `provisioning` with 503 after ~28 seconds

The 28-second timeout is the signature of a container that never passes its startup health check:
- `instanceGetTimeoutMS` = 8s (time to provision the container instance)
- `portReadyTimeoutMS` = 20s (time for the port to start accepting connections)
- Total = 28s → 503 "There is no Container instance available at this time"

**Most likely cause: OOM kill.** The default `instance_type: "lite"` has only 256 MiB RAM. The openclaw gateway gets killed before it can bind to port 18789. Fix: set `"instance_type": "basic"` in `wrangler.jsonc`.

**Other causes to rule out:**
1. **Architecture mismatch** — Cloudflare runs `linux/amd64`. Verify Dockerfile has `FROM --platform=linux/amd64 ...`.
2. **Port not binding** — Test locally: `docker run --rm -p 18789:18789 <image> <cmd>` then `curl http://localhost:18789/ping`. Should return HTTP 200 within 2 seconds.
3. **Image not updated** — Wrangler caches aggressively. If `wrangler containers list --json` shows an old image sha, clear Docker build cache (`docker builder prune -f`) and redeploy.

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
