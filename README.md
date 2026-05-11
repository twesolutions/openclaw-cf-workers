# openclaw on Cloudflare Containers

Runs the [openclaw](https://github.com/openclaw/openclaw) gateway inside a Cloudflare Container — a Docker container managed by a Cloudflare Worker and backed by a Durable Object. Configuration is persisted to an R2 bucket via FUSE mount so it survives container restarts.

## Architecture

- **Worker** (`src/index.ts`) — receives HTTP requests and routes them to the container via `@cloudflare/containers`
- **Container** — runs `ghcr.io/openclaw/openclaw:latest` on Cloudflare's edge
- **R2 bucket** — `~/.openclaw` inside the container is mounted from R2 via tigrisfs, persisting config across restarts

---

## Prerequisites

- [Node.js](https://nodejs.org/) (for `npx wrangler`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — must be running during deploy
- A Cloudflare account with the **Containers beta** enabled (request access at [developers.cloudflare.com](https://developers.cloudflare.com/containers/))
- Workers Paid plan ($5/month) — required for Containers

---

## Step 1 — Clone this repo

```bash
git clone https://github.com/your-org/openclaw-cf-workers.git
cd openclaw-cf-workers
npm install
```

---

## Step 2 — Authenticate Wrangler

```bash
npx wrangler login
```

Note your **account ID** from the Cloudflare dashboard (Workers & Pages → Overview, right sidebar). You'll need it in the next steps.

---

## Step 3 — Create the R2 bucket

```bash
npx wrangler r2 bucket create openclaw-data
```

---

## Step 4 — Create an R2 API token

1. Go to **Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API Token**
2. Set permissions: **Object Read & Write**
3. Scope to bucket: **openclaw-data**
4. **Do not add IP restrictions** — container IPs are dynamic
5. Use **Account API token** (not User API token)

After creating, you'll see three values. You only need two:

| Shown as | Used for | Store as |
|---|---|---|
| Access Key ID | S3-compatible auth | `R2_ACCESS_KEY_ID` secret |
| Secret Access Key | S3-compatible auth | `R2_SECRET_ACCESS_KEY` secret |
| Token value | REST API only | ❌ Not used here |

Store them as Worker secrets:

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

---

## Step 5 — Generate an ed25519 SSH key (for container access)

Only `ssh-ed25519` keys are supported. If you don't have one:

```bash
ssh-keygen -t ed25519 -C "cloudflare-container" -f ~/.ssh/id_ed25519
```

Get the public key:

```bash
cat ~/.ssh/id_ed25519.pub
```

---

## Step 6 — Configure `wrangler.jsonc`

Edit `wrangler.jsonc` and fill in your values:

```jsonc
{
  "name": "openclaw",
  "main": "src/index.ts",
  "compatibility_date": "2025-05-07",
  "containers": [
    {
      "class_name": "OpenclawContainer",
      "image": "./Dockerfile",
      "max_instances": 1,
      "instance_type": "standard-1",
      "ssh": { "enabled": true },
      "authorized_keys": [
        {
          "name": "your-name",
          "public_key": "ssh-ed25519 AAAA... your key here"
        }
      ]
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "name": "OPENCLAW_CONTAINER",
        "class_name": "OpenclawContainer"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["OpenclawContainer"]
    }
  ],
  "vars": {
    "R2_ACCOUNT_ID": "your-cloudflare-account-id",
    "R2_BUCKET_NAME": "openclaw-data"
  }
}
```

### Instance types

| Type | vCPU | RAM | Disk | Notes |
|---|---|---|---|---|
| lite | 1/16 | 256 MiB | 2 GB | Too small for openclaw |
| basic | 1/4 | 1 GiB | 4 GB | Minimum for openclaw |
| standard-1 | 1/2 | 4 GiB | 8 GB | Recommended |
| standard-2 | 1 | 6 GiB | 12 GB | |

---

## Step 7 — Fix Docker credential helper (macOS only)

Docker Desktop's default credential store uses the macOS Keychain and breaks during automated deploys. Set up a file-based credential helper:

```bash
mkdir -p ~/.local/bin
```

Create `~/.local/bin/docker-credential-filecreds`:

```python
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

```bash
chmod +x ~/.local/bin/docker-credential-filecreds
```

Edit `~/.docker/config.json` and set:

```json
{
  "credsStore": "filecreds"
}
```

---

## Step 8 — Deploy

Make sure Docker is running, then:

```bash
npx wrangler deploy
```

The first deploy is slow — Docker must build and push the image to Cloudflare's registry. Subsequent deploys reuse the layer cache and are much faster.

After deploying, wait **2-3 minutes** for the container to be provisioned before sending requests. The first request after a cold start takes **10-15 seconds** due to the R2 mount.

---

## Step 9 — Verify

```bash
# Check container is running
npx wrangler containers list

# Hit the worker (allow up to 35s for cold start)
curl -m 35 -w "\nHTTP %{http_code} in %{time_total}s\n" https://<your-worker>.workers.dev/
```

---

## Step 10 — Configure openclaw

SSH into the running container and run the setup wizard:

```bash
# Get the application ID
npx wrangler containers list

# Get the instance ID
npx wrangler containers instances <APPLICATION_ID>

# SSH in
npx wrangler containers ssh <INSTANCE_ID>

# Inside the container:
openclaw configure
```

Configuration is written to `~/.openclaw` which is mounted from R2 — it persists across restarts.

---

## Idle Sleep

The container sleeps after a period of inactivity to reduce billing. Controlled by `sleepAfter` in `src/index.ts`:

```ts
export class OpenclawContainer extends Container<Env> {
  defaultPort = 18789;
  sleepAfter = "15m";   // adjust as needed
  ...
}
```

Any incoming request (Telegram webhook, browser visit, API call) wakes the container automatically. Cold starts take ~10-15s.

---

## Pricing (standard-1, light usage)

Requires Workers Paid plan ($5/month base).

| Resource | Free monthly | Rate after |
|---|---|---|
| Memory | 25 GiB-hours | $0.0000025/GiB-second |
| vCPU | 375 vCPU-minutes | $0.000020/vCPU-second |
| Disk | 200 GB-hours | $0.00000007/GB-second |

**Estimated: ~$6-7/month** for light Telegram/AI usage. Memory (4 GiB) is the main cost driver — only billed while the container is awake.

---

## Troubleshooting

### Container stuck in `degraded` / 503 after 28 seconds

28s = the sum of `instanceGetTimeoutMS` (8s) + `portReadyTimeoutMS` (20s). The container failed its health check. Most likely causes:

1. **OOM** — upgrade `instance_type` (openclaw needs at least `basic`)
2. **Architecture mismatch** — Dockerfile must have `FROM --platform=linux/amd64 ...`
3. **Script not executable** — Dockerfile must have `RUN chmod +x /startup.sh`
4. **R2 mount hanging** — check credentials and remove IP restrictions from the R2 token

### R2 mount fails (tigrisfs 401 Unauthorized)

- Use Access Key ID + Secret Access Key (not the Token value)
- Use an Account API token, not a User API token
- Remove any IP restrictions from the token
- Check the bucket name matches exactly

### `wrangler deploy` says image unchanged but container is still broken

Force a fresh image build:

```bash
docker builder prune -f
npx wrangler deploy
```

### Updating R2 credentials

```bash
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
npx wrangler deploy
```
