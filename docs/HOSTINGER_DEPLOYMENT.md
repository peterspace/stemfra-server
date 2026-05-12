# Hostinger Deployment Guide

How `stemfra-server` runs in production on the Hostinger VPS, end to end. Internal reference.

**Live URL:** https://api.stemfra.com

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Prerequisites](#prerequisites)
3. [Files in the repo](#files-in-the-repo)
4. [First-time deployment](#first-time-deployment)
5. [Continuous deployment via GitHub Actions](#continuous-deployment-via-github-actions)
6. [DNS + TLS](#dns--tls)
7. [Verifying the deploy](#verifying-the-deploy)
8. [Common operations](#common-operations)
9. [Troubleshooting](#troubleshooting)
10. [Gotchas we hit (and learned from)](#gotchas-we-hit-and-learned-from)

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│ Hostinger VPS (srv1555257.hstgr.cloud — IP 76.13.120.71)        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ Docker network: space (external, shared)                │    │
│  │                                                         │    │
│  │  ┌────────────┐    ┌──────────┐    ┌──────────────────┐ │    │
│  │  │ Traefik    │←───│ n8n      │    │ stemfra-server   │ │    │
│  │  │ (in n8n    │    │          │    │ ┌──────────────┐ │ │    │
│  │  │  project)  │    └──────────┘    │ │ api (Node 22)│ │ │    │
│  │  │ :80, :443  │                    │ │ :4000        │ │ │    │
│  │  └─────┬──────┘                    │ └──────────────┘ │ │    │
│  │        │                           └──────────────────┘ │    │
│  │        │       ┌──────────┐                             │    │
│  │        │       │ ollama   │   ┌──────────┐              │    │
│  │        │       └──────────┘   │ openclaw │              │    │
│  │        │                      └──────────┘              │    │
│  └────────┼─────────────────────────────────────────────────┘    │
│           │                                                     │
└───────────┼─────────────────────────────────────────────────────┘
            │ port 443 (HTTPS)
            ▼
   api.stemfra.com (Cloudflare DNS, grey cloud)
            ▲
            │
        Internet
```

**Key facts:**

- **One Traefik instance** for the whole VPS, living inside the `n8n` compose project. It owns ports 80/443 and routes by `Host` header to whichever container has matching labels.
- All projects join the **`space` external network** so Traefik can reach them.
- TLS certs come from **Let's Encrypt via the TLS-ALPN-01 challenge** (`mytlschallenge` resolver in Traefik config).
- **`stemfra-server` is stateless** — Supabase handles all persistence. No volumes, no local DB.
- **CI/CD:** push to `main` → GitHub Actions → Hostinger API → Docker Manager redeploys.

---

## Prerequisites

| | Value |
|---|---|
| Hostinger VPS with Docker Manager | VM ID `1555257` |
| Docker network `space` | Created when n8n+Traefik were set up |
| Traefik cert resolver | `mytlschallenge` (TLS-ALPN-01) |
| GitHub repo | https://github.com/peterspace/stemfra-server |
| DNS provider | Cloudflare (`stemfra.com` zone) |
| Supabase project | `acxepovfklgthxmteqxr` |
| Gmail SMTP | `support@stemfra.com` + App Password |

---

## Files in the repo

Four files own the deployment. None of them contain secrets.

### `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

# Use non-root user shipped with the node image
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "index.js"]
```

Two-stage build (deps + runtime), non-root user, healthcheck against the app's `/health` endpoint. Node 22 because that's what the rest of the stack uses.

### `.dockerignore`

```
node_modules
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Local env — provided on the host via env_file
.env
.env.*
!.env.example

# Git / editor / OS
.git
.gitignore
.vscode
.idea
.DS_Store

# Build artifacts / coverage
coverage
build
dist

# Docs / local-only
README.md
*.md
docker-compose.yml
.dockerignore
Dockerfile
```

### `docker-compose.yml`

```yaml
services:
  api:
    build: .
    image: stemfra-server:latest
    init: true
    restart: unless-stopped
    expose:
      - "4000"
    env_file:
      - .env
    labels:
      - traefik.enable=true
      - traefik.docker.network=space
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.rule=Host(`${API_HOST}`)
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.entrypoints=websecure
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.tls.certresolver=mytlschallenge
      - traefik.http.services.${COMPOSE_PROJECT_NAME}.loadbalancer.server.port=4000
      # Security headers
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}.headers.STSSeconds=315360000
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}.headers.browserXSSFilter=true
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}.headers.contentTypeNosniff=true
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}.headers.forceSTSHeader=true
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}.headers.STSIncludeSubdomains=true
      - traefik.http.middlewares.${COMPOSE_PROJECT_NAME}.headers.STSPreload=true
      - traefik.http.routers.${COMPOSE_PROJECT_NAME}.middlewares=${COMPOSE_PROJECT_NAME}@docker
    networks:
      - default
      - n8n_default
      - space

networks:
  default:
    name: ${COMPOSE_PROJECT_NAME}_default
  n8n_default:
    external: true
  space:
    external: true
```

Why each non-obvious thing:

- **`service: api`** (not `stemfra-server`) — keeps the container name as `stemfra-server-api-1` instead of `stemfra-server-stemfra-server-1`.
- **`${COMPOSE_PROJECT_NAME}` in label keys** — avoids collisions with other projects' Traefik routers/middlewares (e.g. `openclaw-e1uk`).
- **`${API_HOST}` interpolation** — Compose reads `.env` for variable substitution at load time. The actual app env vars come via `env_file`.
- **`expose:` not `ports:`** — port 4000 is reachable only inside the Docker network. Traefik is the sole public ingress; we don't want to bypass its TLS.
- **`entrypoints=websecure` only** — Traefik's global config does the :80→:443 redirect already.
- **Three networks** — `space` is the shared bus where Traefik finds us; `n8n_default` matches the openclaw pattern (defense in depth); `default` is the project-local one.
- **`init: true`** — proper signal handling and zombie reaping for Node.

### `.env.example`

The local-dev template. Production values do **not** come from this file — they come from the GitHub Actions workflow. This file exists only so `git clone && cp .env.example .env && npm run dev` works for new developers.

```bash
NODE_ENV=production
PORT=4000
API_HOST=stemfra-server.srv1555257.hstgr.cloud  # not actually used for local dev
CLIENT_URL=http://localhost:5173
SUPABASE_URL=https://acxepovfklgthxmteqxr.supabase.co
SUPABASE_SECRET_KEY=
GMAIL_USER=support@stemfra.com
GMAIL_APP_PASSWORD=
NOTIFY_EMAIL=support@stemfra.com
LOGO_URL=https://stemfra.com/stemfra_logo.png
```

Never put real `SUPABASE_SECRET_KEY` or `GMAIL_APP_PASSWORD` here.

---

## First-time deployment

> ⚠️ **You should only do this once per VPS.** After that, CI/CD takes over.

### 1. Push the four files above to GitHub

(They're already in `main`.)

### 2. Install via Hostinger Docker Manager

1. hPanel → VPS → Docker Manager → **Compose ▾** → "Install from GitHub URL"
2. Repo URL: `https://github.com/peterspace/stemfra-server.git`
3. Branch: `main`
4. Compose path: `docker-compose.yml`
5. Click **Deploy**

### 3. First deploy will crash — that's expected

Hostinger creates the project with empty env vars, then surfaces the Environment panel. Until env vars are filled in, the container exits because `config/supabase.js` does:

```js
if (!supabaseUrl || !supabaseSecretKey) {
  console.error('✗ Missing SUPABASE_URL or SUPABASE_SECRET_KEY in environment.');
  process.exit(1);
}
```

This is normal. Move to step 4.

### 4. Set up GitHub Secrets and Variables (one-time)

GitHub repo → Settings → Secrets and variables → Actions.

**Secrets** (encrypted, never visible after save):

| Name | Where to get it |
|---|---|
| `HOSTINGER_API_KEY` | hPanel → top-right avatar → API → Generate token |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Project Settings → API → "Secret keys" (starts with `sb_secret_…`) |
| `GMAIL_APP_PASSWORD` | https://myaccount.google.com/apppasswords (16-char string, paste without spaces) |

**Variables** (plain text):

| Name | Value |
|---|---|
| `HOSTINGER_VM_ID` | `1555257` (the numeric ID in your VPS URL) |

### 5. Trigger the first CI/CD deploy

Either push any commit to `main`, or manually trigger:

GitHub repo → Actions → **Deploy to Hostinger** → Run workflow → main → Run workflow

This run will:
- Call Hostinger's API
- Write the full env config (from the workflow YAML) into the project's Environment panel
- Trigger a rebuild
- Container comes up healthy

After this point, the deployment is live.

---

## Continuous deployment via GitHub Actions

Every push to `main` triggers an auto-redeploy. The workflow file:

### `.github/workflows/deploy.yml`

```yaml
name: Deploy to Hostinger

on:
  push:
    branches:
      - main
  workflow_dispatch: # allows manual trigger from the Actions tab

jobs:
  deploy:
    name: Redeploy stemfra-server
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Deploy to Hostinger
        uses: hostinger/deploy-on-vps@v2
        with:
          api-key: ${{ secrets.HOSTINGER_API_KEY }}
          virtual-machine: ${{ vars.HOSTINGER_VM_ID }}
          project-name: stemfra-server
          docker-compose-path: docker-compose.yml
          environment-variables: |
            NODE_ENV=production
            PORT=4000
            API_HOST=api.stemfra.com
            CLIENT_URL=https://stemfra.com
            SUPABASE_URL=https://acxepovfklgthxmteqxr.supabase.co
            SUPABASE_SECRET_KEY=${{ secrets.SUPABASE_SECRET_KEY }}
            GMAIL_USER=support@stemfra.com
            GMAIL_APP_PASSWORD=${{ secrets.GMAIL_APP_PASSWORD }}
            NOTIFY_EMAIL=support@stemfra.com
            LOGO_URL=https://stemfra.com/stemfra_logo.png
```

### Why all env vars live in the workflow

The action's `environment-variables` parameter **replaces, not merges** the project's env. If we passed only the two secrets, every other var (NODE_ENV, API_HOST, etc.) would be wiped on each deploy. So the workflow is the single source of truth for production env config.

- **Non-sensitive values** (URLs, usernames) are inline in the YAML.
- **Sensitive values** come from GitHub Secrets, interpolated at workflow run time.
- **Nothing about secrets is ever committed** to git.

### Editing config

To change a config value:

- **Non-sensitive:** edit the workflow YAML and push.
- **Sensitive:** edit the GitHub Secret in repo settings; push any commit (or use "Run workflow" manually).

> ⚠️ **Do not edit env vars in Hostinger's UI** — the next push will overwrite your edits.

---

## DNS + TLS

### Cloudflare DNS record

In the Cloudflare dashboard for `stemfra.com`:

| Type | Name | IPv4 | Proxy status | TTL |
|---|---|---|---|---|
| A | `api` | `76.13.120.71` | **DNS only** (grey cloud) | Auto |

### Why "DNS only" matters

Traefik issues certs via Let's Encrypt's **TLS-ALPN-01** challenge:

```
--certificatesresolvers.mytlschallenge.acme.tlschallenge=true
```

This requires Let's Encrypt to reach port 443 on the VPS directly. If Cloudflare's proxy is on (orange cloud), Cloudflare terminates TLS instead, the challenge fails, and Traefik falls back to a self-signed cert. Browsers and `curl` then reject the connection.

If you ever need Cloudflare proxy benefits (DDoS, caching), the fix is to switch the Traefik cert resolver from TLS-ALPN-01 to **DNS-01**, using a Cloudflare API token. That's a larger change — flag it separately.

### Hostinger's `*.hstgr.cloud` auto-hostnames don't work for TLS

We tried `stemfra-server.srv1555257.hstgr.cloud` first. DNS resolved fine, container responded fine, but **Let's Encrypt won't issue certs for that domain** (likely Public Suffix List treatment for shared-hosting subdomains). Use real DNS via Cloudflare instead.

---

## Verifying the deploy

```bash
# Public, with TLS verification — the real test
curl https://api.stemfra.com/health

# Expected response:
# {"status":"ok","server":"STEMfra API","timestamp":"..."}

# Just the status code:
curl -o /dev/null -s -w "%{http_code}\n" https://api.stemfra.com/health
# 200
```

If any of those fail, see [Troubleshooting](#troubleshooting).

---

## Common operations

All run from Hostinger Terminal (top-right "Terminal" button) unless noted.

### Find the container name

Container naming is `{project}-{service}-{instance}` → `stemfra-server-api-1`. To be safe:

```bash
docker ps --filter "name=stemfra" --format "{{.Names}}"
```

### Tail live logs

```bash
docker logs -f $(docker ps -aq --filter "name=stemfra" | head -1)
```

### Restart without rebuilding

```bash
docker compose -f /path/to/stemfra-server/docker-compose.yml restart api
```

Easier: trigger a redeploy by manually running the workflow in GitHub Actions.

### Test SMTP outbound (only needed once)

```bash
nc -vz smtp.gmail.com 587
```

Should connect. If it hangs, Hostinger is blocking SMTP and we need to switch to a transactional provider (Resend/Postmark).

### See what env vars are actually set inside the container

```bash
docker exec $(docker ps -aq --filter "name=stemfra" | head -1) env | sort
```

### Check Traefik's view of our service

```bash
docker logs --tail 100 n8n-traefik-1 2>&1 | grep -iE "stemfra|api\.stemfra|acme"
```

---

## Troubleshooting

### Symptom: `curl: (60) SSL certificate problem`

Traefik is serving its default self-signed cert because Let's Encrypt issuance failed.

**Diagnosis:**
```bash
curl -kv https://api.stemfra.com/health 2>&1 | grep -i "issuer:\|subject:"
```

If issuer is `TRAEFIK DEFAULT CERT`, Let's Encrypt didn't issue a real one.

**Common causes:**
1. **Cloudflare proxy is on** (orange cloud) — switch to DNS only.
2. **DNS hasn't propagated yet** — wait a minute, try again.
3. **Hostname uses `.hstgr.cloud`** — won't work; use a domain you control.

### Symptom: 404 page not found

Traefik can't find a matching router for the hostname.

**Diagnosis:**
```bash
docker logs --tail 50 n8n-traefik-1 2>&1 | grep -i "stemfra\|api.stemfra"
```

**Common causes:**
1. **`API_HOST` in workflow doesn't match the URL you're hitting** — verify both.
2. **Container not on `space` network** — `docker network inspect space` and look for the container name.
3. **Traefik can't see the labels** — restart the project from Docker Manager.

### Symptom: 502 / 503 Bad Gateway

Traefik routes correctly but the container isn't responding.

**Diagnosis:**
```bash
docker ps --filter "name=stemfra" --format "{{.Names}}: {{.Status}}"
docker logs --tail 50 $(docker ps -aq --filter "name=stemfra" | head -1)
```

**Common causes:**
1. **Container crash-looping** — almost always missing/wrong env vars. Look for `Missing SUPABASE_URL or SUPABASE_SECRET_KEY` in logs.
2. **App threw on boot** — check the log tail.

### Symptom: GitHub Actions run fails with "Unable to resolve action"

The action name is `hostinger/deploy-on-vps@v2`. **Not** `hostinger/deploy-action@v1` — that's what Hostinger's own docs say but the repo doesn't exist. See [Gotchas](#gotchas-we-hit-and-learned-from).

### Symptom: `npm ci` fails in the Docker build

`package-lock.json` isn't in the repo. Check `.gitignore` — make sure it does NOT list `package-lock.json`. Commit the lockfile.

### Symptom: Env vars get wiped to empty after each deploy

You forgot to add a var to the workflow's `environment-variables` block. The action replaces — every required var must be listed there. See [Gotchas](#gotchas-we-hit-and-learned-from).

---

## Gotchas we hit (and learned from)

1. **Hostinger's docs reference a non-existent GitHub action.**
   Their support pages cite `hostinger/deploy-action@v1`. The real one is `hostinger/deploy-on-vps@v2` (different repo, different version). If you find `deploy-action` referenced anywhere, it's wrong.

2. **`environment-variables` in `deploy-on-vps@v2` replaces, not merges.**
   We initially passed only the two sensitive vars and lost all the others. Now every required env var lives in the workflow YAML.

3. **`.env.example` is read by Hostinger on every deploy.**
   On first install, Hostinger reads the file to pre-populate the Environment panel. On every subsequent deploy, anything *not* overridden by the workflow's `environment-variables` falls back to this file's defaults. Empty values in the file become empty env vars in the container. So: no real secrets in `.env.example` (ever), and treat it as a dev template only.

4. **Hostinger's `*.hstgr.cloud` subdomains can't get Let's Encrypt certs.**
   Use real DNS via Cloudflare from day one. Don't waste time on the auto-hostname.

5. **Cloudflare proxy must be off (grey cloud) for TLS-ALPN-01 to work.**
   Critical, easy to miss. Orange cloud = no cert.

6. **`package-lock.json` must be committed.**
   `npm ci` (used in our Dockerfile for reproducible installs) refuses to run without it. Default Node `.gitignore` templates sometimes exclude it — verify and remove.

7. **The build crashes on first deploy because env vars aren't set yet.**
   This is Hostinger's deploy-then-configure flow. The container will restart-loop until you fill the Environment panel. Expected; not a bug.

8. **Container name is `{project}-{service}-{instance}`, not `{project}`.**
   `docker exec stemfra-server …` won't work. Use `docker ps --filter "name=stemfra"` to find the real name.

9. **Two Traefik instances would fight for ports 80/443.**
   Don't click "Deploy Traefik" from the Docker Manager dashboard if Traefik is already running inside the n8n project. We have exactly one Traefik on this VPS.

10. **Renaming the compose service after install is fine.**
    Docker Compose detects the rename, removes the old container, creates the new one. Brief ~5s of 502 during the swap, then back to normal.

---

## Future work / known limitations

- **Outbound SMTP through Hostinger** — not yet stress-tested. If Gmail-via-Nodemailer doesn't work in production (port 587 blocked by Hostinger), switch to a transactional provider (Resend/Postmark) — same Nodemailer API, different transport.
- **Cert renewal is automatic** (Traefik handles it), but worth checking the Traefik logs once every couple of months to confirm.
- **No staging environment** — all deploys go to production. If we ever need staging, the cleanest path is a second VPS or a separate project (`stemfra-server-staging`) with a different `API_HOST`.
- **No alerting on container failure** — would need to add an external uptime monitor (UptimeRobot, Better Stack, etc.) hitting `/health` every minute.

---

*Last updated: 2026-05-12 after the deployment shipped to production.*
