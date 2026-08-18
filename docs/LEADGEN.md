# Lead-Gen Module — Server Side

> **What happens AFTER a lead lands** (templates, Mark's sends, the follow-up drip,
> read-gated voice calls) is documented in [OUTREACH.md](OUTREACH.md) — read it before
> touching send-outreach, the sequencer, or the Score & Draft prompt.

How `stemfra-server` brokers AI-scored lead-gen runs between the CRM and the
n8n workflow that does the actual scraping + scoring + DB insert.

**Live route:** `POST https://api.stemfra.com/api/leadgen/trigger`
**Source:** [`routes/leadgen.js`](../routes/leadgen.js)
**Mounted in:** [`index.js`](../index.js) as `app.use('/api/leadgen', leadgenRoutes)`

---

## What this server does (and does not do)

This server is a **thin, authenticated bridge** in front of n8n:

```
┌────────────────┐   Bearer JWT    ┌───────────────────┐  x-leadgen-secret  ┌────────────┐
│ crm.stemfra.com│ ─────────────▶ │ api.stemfra.com   │ ─────────────────▶ │ n8n.srv... │
│ (Fetch Leads UI)│                 │ /api/leadgen/trigger                  │ workflow   │
└────────────────┘                 └───────────────────┘                    └─────┬──────┘
                                                                                  │
                                                                                  │ scrape → score → insert
                                                                                  ▼
                                                                          ┌────────────┐
                                                                          │  Supabase  │
                                                                          │ leads table│
                                                                          │ review_status= 'needs_review'
                                                                          └────────────┘
```

What `routes/leadgen.js` is responsible for:

1. **Auth** — verifies the caller's Supabase JWT.
2. **Validation** — system ∈ {cold, warm}, vertical against an allow-list, city required, clamps max_results/min_score so a bad call can't waste an Apify/Claude run.
3. **Webhook URL selection** — picks `N8N_LEADGEN_COLD_URL` or `N8N_LEADGEN_WARM_URL` from env based on the `system` field.
4. **Search-query composition** — builds the human-readable Google Maps query from `city, state_name, country_name` so the scraper doesn't return Brooklyn IA when the user picked Brooklyn NY.
5. **Webhook firing** — POSTs the payload to n8n with the `x-leadgen-secret` header attached so n8n can verify the request actually came from us.
6. **Activity logging** — best-effort row in `activity_feed` so the run is auditable in the CRM's activity stream.
7. **Async-friendly response** — uses a 25 s AbortController so a slow n8n doesn't hang the HTTP request. A timed-out request returns `202 Accepted` because the workflow keeps running on n8n's side and writes leads when done.

What it does **not** do:

- Scraping. n8n handles Apify / direct Google Maps calls.
- AI scoring. n8n calls Claude (or whatever model) inside the workflow.
- Writing to the `leads` table. n8n inserts directly via the Supabase service-role credentials baked into its workflow.

---

## Endpoint contract

### Request

`POST /api/leadgen/trigger`

| Header | Value | Required |
|---|---|---|
| `Authorization` | `Bearer <supabase_access_token>` | ✓ |
| `Content-Type` | `application/json` | ✓ |

Body fields (all optional unless flagged):

| Field | Type | Default | Notes |
|---|---|---|---|
| `system` | `'cold' \| 'warm'` | `'cold'` | Selects which n8n webhook to fire. |
| `vertical` | string | `'barbershop'` | Must match the server-side `KNOWN_VERTICALS` allow-list. |
| `city` | string | `''` | **Required** for `system='cold'` (unless `search_query` is set explicitly). |
| `country` | string | `null` | ISO-2 (e.g. `'US'`). Sent through to n8n; not used to build the default query. |
| `country_name` | string | `null` | Human-readable (e.g. `'United States'`). Used in the default `search_query`. |
| `state_code` | string | `null` | e.g. `'NY'`. Fallback in the default `search_query` when `state_name` is empty. |
| `state_name` | string | `null` | e.g. `'New York'`. Preferred in the default `search_query`. |
| `max_results` | int | `30` | Clamped 1–100. |
| `min_score` | int | `5` | Clamped 1–10. The workflow drops leads scoring below this. |
| `search_query` | string | _(see below)_ | Override the default composed query. |

#### How `search_query` is composed when not passed

```
verticalText = vertical.replace('_', ' ')
stateSegment   = state_name   || state_code   || null
countrySegment = country_name || country      || null
segments       = [city, stateSegment, countrySegment].filter(Boolean)
search_query   = `${verticalText} in ${segments.join(', ')}`
```

Examples:

| Input | Resulting `search_query` |
|---|---|
| Brooklyn / NY / US (full names) | `barbershop in Brooklyn, New York, United States` |
| Brooklyn / NY / US (no state name) | `barbershop in Brooklyn, NY, United States` |
| Lagos / NG (country has no states) | `barbershop in Lagos, Nigeria` |
| Brooklyn only (legacy / no geo enrichment) | `barbershop in Brooklyn` |

### Responses

| Status | When | Body |
|---|---|---|
| `202 Accepted` | n8n ack'd the run, OR n8n didn't respond within 25 s (run still in progress) | `{ success: true, message: "Lead-gen cold run started for barbershop in Brooklyn. New leads will appear in the review queue shortly." }` |
| `400 Bad Request` | Validation failed | `{ success: false, message: "..." }` |
| `401 Unauthorized` | No or invalid Bearer JWT | `{ success: false, message: "Unauthorized" }` |
| `502 Bad Gateway` | n8n returned non-2xx | `{ success: false, message: "Lead-gen workflow could not be started (n8n responded NNN)." }` |
| `503 Service Unavailable` | `N8N_LEADGEN_COLD_URL` (or warm) not set | `{ success: false, message: "Lead-gen (cold) is not configured on the server yet." }` |

---

## Environment variables

Source of truth: [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) — the Hostinger deploy action REPLACES the project env each time, so anything not listed there gets wiped.

| Var | Source | Notes |
|---|---|---|
| `N8N_LEADGEN_COLD_URL` | Hardcoded in `deploy.yml` | `https://n8n.srv1555257.hstgr.cloud/webhook/leadgen-cold`. **Public host, not loopback** — see Docker container gotcha below. |
| `N8N_LEADGEN_WARM_URL` | Hardcoded in `deploy.yml` | `https://n8n.srv1555257.hstgr.cloud/webhook/leadgen-warm`. Workflow may not exist yet — that's fine, the endpoint returns 503 for `system='warm'` until n8n responds 2xx. |
| `N8N_WEBHOOK_SECRET` | GitHub Secret | Sent as `x-leadgen-secret` header. **The n8n workflow MUST verify it** now that n8n's endpoint is publicly reachable. |

---

## ⚠ Docker container loopback gotcha

This bit us once and is worth remembering. The first iteration of the env config had:

```
N8N_LEADGEN_COLD_URL=http://127.0.0.1:5678/webhook/leadgen-cold
```

This **does not work**. From inside the `stemfra-server` container, `127.0.0.1` resolves to the container itself, not the host's `127.0.0.1` where n8n is listening on `:5678`. The route returned `500 fetch failed` on every triggered run.

**Three correct options**, in order of preference:

1. **Public n8n hostname** (what we use now): `https://n8n.srv1555257.hstgr.cloud/webhook/...` — traverses Traefik on the VPS and reaches the n8n container's port the normal way. Authenticity is gated by the `x-leadgen-secret` header which the n8n workflow verifies.
2. **Docker Compose service name** — if `stemfra-server` and `n8n` were in the same compose file, we could use `http://n8n:5678/webhook/...`. They're not (n8n owns Traefik, runs in its own compose project), so this isn't available without restructuring.
3. **Docker host gateway** — `http://host.docker.internal:5678` works on macOS/Windows but is unreliable on Linux without `--add-host`. Not worth the fragility.

If you ever see `fetch failed` from `/api/leadgen/trigger`, check that the URL in the prod env is the public hostname, not loopback. (See the cross-repo memory note `docker_container_loopback_gotcha.md`.)

---

## n8n contract expectations

The n8n workflow must:

1. **Verify the `x-leadgen-secret` header** matches its own configured secret. Reject otherwise (any non-2xx status; the server logs and surfaces it as a 502 to the client).
2. **Be Active / Published** in the n8n editor — the production webhook path (`/webhook/leadgen-cold`) only responds when the workflow is activated. The test path (`/webhook-test/...`) is for editor-side runs and won't be hit by this server.
3. **Use the production webhook path** — `path` attribute on the Webhook Trigger node must match `leadgen-cold` (or `leadgen-warm`).
4. **Write back to Supabase `leads`** with `review_status='needs_review'` so the rows show up in the CRM Review Queue.

The payload n8n receives is:

```json
{
  "system":       "cold",
  "vertical":     "barbershop",
  "city":         "Brooklyn",
  "country":      "US",
  "country_name": "United States",
  "state_code":   "NY",
  "state_name":   "New York",
  "search_query": "barbershop in Brooklyn, New York, United States",
  "max_results":  30,
  "min_score":    5,
  "triggered_by": "<supabase user uuid>",
  "triggered_at": "2026-05-22T17:30:00.000Z"
}
```

---

## Verifying a deploy

```bash
# 1. /health responds
curl -s --max-time 6 https://api.stemfra.com/health

# 2. Route is mounted + gating on auth (NOT 503 → env vars are set;
#    NOT 404 → route is mounted; NOT 500 → app didn't crash)
curl -i -X POST https://api.stemfra.com/api/leadgen/trigger \
  -H 'Content-Type: application/json' \
  -d '{"vertical":"barbershop","city":"Brooklyn"}'
# Expect: HTTP/2 401  {"success":false,"message":"Unauthorized"}
```

For a real end-to-end test, kick off a run from `crm.stemfra.com` (Lead Pipeline → Fetch Leads). The new leads appear in the Review Queue tab as n8n finishes its scrape.

---

## Coverage ledger (`leadgen_runs`, 2026-08-18, launch task #6)

Every triggered run writes ONE `leadgen_runs` row BEFORE the webhook fires
(system, vertical, country/state/city, search_query, max_results, min_score,
requested_by, status `requested` → `failed` when n8n rejects). The row's id rides
on the n8n payload as **`run_id`**.

**⚠ n8n change (Peter pastes):** in the cold + warm workflows' Supabase insert
node, add the column `leadgen_run_id` = `{{ $('Webhook').item.json.body.run_id }}`
(the trigger payload). That is what links each scraped lead to the run, so the
CRM Coverage tab can derive found / approved / contacted / won per city without
any double entry. Until the paste, runs still record coverage; counts read 0.

Endpoints (staff JWT): `GET /api/leadgen/coverage?vertical=&country=&days=` →
`{ runs, areas, states }` (areas = vertical·country·state·city rollup, states =
per-state rollup); `POST /api/leadgen/runs` (log a manual sweep: vertical +
state and/or city, optional leads_found/notes/requested_at); `PATCH
/api/leadgen/runs/:id` (status/notes/leads_found). CRM: Lead Pipeline →
**Coverage** tab (`stemfra-ops/src/components/leadgen/Coverage.jsx`).

(The former `activity_feed` 'leadgen_run' insert never landed: the table's
`entity_type` CHECK rejected it silently for two months. Removed.)

## Files touched by this module

| Path | What |
|---|---|
| `routes/leadgen.js` | The endpoint itself + validation + n8n bridge |
| `index.js` | Mounts the router at `/api/leadgen` |
| `.github/workflows/deploy.yml` | Injects the three env vars |
| `.env.example` | Documents the same vars for local dev |
