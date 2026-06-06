# Copilot Proxy · Multi-tenant

Centrally manage many GitHub Copilot accounts behind **one shared API endpoint**.
Each team member logs into a web platform, binds their own GitHub Copilot account
(via GitHub device flow), and gets a personal API key. Clients call the same
gateway URL with their key and reach their own Copilot models.

> 中文版：[README.zh-CN.md](README.zh-CN.md)

## Architecture

- **control-plane** (`:8080`) — web platform: local login, admin user management,
  API-key management, GitHub device-flow binding. On bind it launches one
  `copilot-proxy-api` container per account (full OpenAI + Anthropic + Codex
  compatibility, unmodified upstream image).
- **gateway** (`:4000`) — single shared API endpoint. Resolves `Bearer <cpx-key>`
  → user → account container, then reverse-proxies (streaming-safe).
- **per-account containers** `cpx-acct-<id>` — one `copilot-proxy-api` each,
  siblings on the host Docker daemon, joined to the `cpx-net` network. Internal
  only, never exposed to the host.
- **SQLite** (`./data/cpx.db`) — users, hashed API keys, encrypted GitHub tokens,
  usage logs.

GitHub tokens are encrypted at rest with AES-256-GCM using `CPX_MASTER_KEY`.

## Quick start

```bash
cp .env.example .env
# Edit .env: set CPX_MASTER_KEY (64-char hex), CPX_ADMIN_PASS, CPX_SESSION_SECRET.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # master key

docker compose up --build -d
```

Then:

1. Open `http://localhost:8080`, log in as the bootstrap admin (`CPX_ADMIN_USER` /
   `CPX_ADMIN_PASS`).
2. Admin → create users for your team.
3. As a user: **Connect GitHub Copilot** → open the shown URL, enter the code,
   approve. A per-account proxy container starts automatically.
4. **Create API key** on the dashboard (copy it — shown once).
5. Use the unified endpoint:

```bash
curl http://localhost:4000/v1/models -H "Authorization: Bearer YOUR_CPX_KEY"
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_CPX_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

## Local dev (without Docker for the two services)

```bash
npm install
# terminal 1 (dev scripts pin a shared absolute DB path automatically)
npm run dev:cp
# terminal 2
npm run dev:gw
```

> Both services must point at the **same** SQLite file. `npm -w <pkg> run` sets
> the working directory to the package folder, so a relative `CPX_DB_PATH` would
> resolve per-package and silently split the DB. The `dev:*` scripts and the
> compose file both use an absolute path to avoid this.

Note: binding still launches real `copilot-proxy-api` containers via your local
Docker daemon, and the gateway reaches them by container name — so for end-to-end
proxying run the gateway inside `cpx-net` (i.e. via `docker compose`).

## Gateway error codes

The gateway returns predictable codes. A background health monitor in the
control-plane probes each account every 30s and reconciles `account.status`, so a
logged-out / unhealthy account surfaces as a clean `503` rather than intermittent
`502`/`401`.

| HTTP | `error.type` | When |
| --- | --- | --- |
| 401 | (missing/invalid) | No key, unknown key, or revoked key |
| 403 | (unbound) | Valid key but the user has not bound a Copilot account |
| 503 | `account_not_ready` | Account `pending` / `stopped` / `error` (e.g. GitHub logged out — container won't start) |
| 502 | `upstream_unavailable` | Container should be up but is unreachable (transient). Internal container names are never leaked |
| 200 + upstream codes | — | Healthy; upstream copilot-proxy-api responses pass through unchanged |

Notes:
- When a GitHub account is logged out / its token revoked, the per-account
  `copilot-proxy-api` container fails its startup token check and exits, so the
  health monitor marks the account `stopped`/`error` → gateway returns `503`.
- Set `CPX_VERBOSE=1` on the gateway to log (server-side only) the real upstream
  error behind a `502`.

## Token metering

The gateway's `usage_logs` table records **one row per call** (who / which account
/ path / model / HTTP status / timestamp) — it does **not** store token counts.
Inspect it directly:

```bash
docker compose exec -T control-plane node -e "
const db=require('better-sqlite3')('/app/data/cpx.db');
console.table(db.prepare('SELECT id,user_id,account_id,path,model,status_code,created_at FROM usage_logs ORDER BY id DESC LIMIT 20').all());
"
```

Token consumption itself is reported by the **upstream model in the response body**,
not by the proxy. Where to read it depends on the API surface you call:

| API surface | Endpoint | Token fields in the JSON response |
| --- | --- | --- |
| OpenAI Chat Completions | `/v1/chat/completions` | `usage.prompt_tokens`, `usage.completion_tokens`, `usage.total_tokens` |
| OpenAI Responses | `/v1/responses` | `usage.input_tokens`, `usage.output_tokens`; plus `copilot_usage.token_details[]` (per-type `token_count`: `input` / `output` / `cache_read`) and `copilot_usage.total_nano_aiu` (billing units) |
| Anthropic Messages | `/v1/messages` | `usage.input_tokens`, `usage.output_tokens`, `usage.cache_read_input_tokens` (cache hits) |

Notes:
- For **streaming** requests, OpenAI only includes the `usage` block in the final
  chunk if you send `"stream_options": {"include_usage": true}`. Anthropic emits
  usage in the `message_delta` / final event by default.
- The gateway does **not** currently parse these fields into the DB (it reverse-
  proxies the byte stream as-is). To meter by token, either have clients read the
  `usage` block from each response, or extend the gateway to sniff the trailing
  `usage` and add `prompt/completion/total` columns to `usage_logs`.
- Prompt caching is real on this path: with Anthropic `cache_control`, warm calls
  show `cache_read_input_tokens` > 0 and billed input collapses to the new tokens.

## Notes / limits (demo)

- Sessions are in-memory; restarting control-plane logs users out.
- Containers run resident (no idle stop). For 10–50 accounts that's fine; at the
  high end watch RAM (~40–90 MB per idle proxy).
- Heavy automated traffic across many accounts can trip GitHub abuse detection.
- This relies on a reverse-engineered Copilot API; review GitHub Copilot terms.
