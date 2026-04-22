# Multi-Tenant Slack App Distribution

Goal: Allow any Slack workspace to install this app via a standard "Add to Slack" OAuth flow,
with each workspace having its own isolated bot token and configuration.

---

## What needs to change (high level)

### 1. Switch from Socket Mode to HTTP mode

Currently the app uses Slack Bolt's Socket Mode, which maintains a single persistent WebSocket
connection and only works for one workspace at a time.

- Remove `socketMode: true` and `appToken` from Bolt `App` constructor
- Add a public HTTPS endpoint (e.g. `/slack/events`) that Slack POSTs events to
- Expose port externally — needs a real domain or a tunnel (ngrok for dev, a proper server for prod)
- Set **Request URL** in Slack app settings → Event Subscriptions and Interactivity

### 2. Implement per-workspace OAuth 2.0 token storage

Each installing workspace gets its own `bot_token`. These must be stored and retrieved per-team.

- Add an OAuth install route (e.g. `/slack/install`) that redirects to Slack's OAuth page
- Add an OAuth callback route (e.g. `/slack/oauth_redirect`) that exchanges the code for a token
- Store `{ team_id, bot_token, bot_user_id }` in a database (see section 4)
- On every incoming event, look up the token for `team_id` from the database and use it for API calls

Bolt has built-in OAuth support (`installationStore`) that handles most of this.

### 3. Scope and permission changes

- Add `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` env vars (from Slack app settings → Basic Information)
- Remove `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` from required env vars (no longer a single static token)
- Update env validation in `src/common/config/env.validation.ts`

### 4. Add a database for token storage

Need persistent storage for installation records. Minimum schema:

```
installations
  id           serial primary key
  team_id      text unique not null
  bot_token    text not null
  bot_user_id  text
  installed_at timestamptz default now()
```

Options (pick one):
- SQLite (simplest, single-file, no infra — good for early stage)
- PostgreSQL (production-ready, needs a hosted instance)
- KV store (Redis, Upstash) — simpler schema but less queryable

### 5. Per-workspace GitHub token

Currently `GITHUB_TOKEN` is a single global token. In multi-tenant mode each workspace/user
would need to authorize their own GitHub account.

- Option A (simpler): Keep a single global GitHub token — requires the installing user to trust
  the app with their repos, or the app uses a GitHub App installation token
- Option B: GitHub OAuth per workspace — full GitHub App with per-installation tokens
  (significantly more work; out of scope for MVP)

Recommended: start with Option A (global token or GitHub App bot account).

### 6. Deploy to a real server

Socket Mode doesn't need a public URL. HTTP mode does.

- Deploy to any hosting platform (Railway, Fly.io, Render, AWS, etc.)
- Configure HTTPS (most platforms provide it automatically)
- Set the Slack Request URL in app settings to `https://<your-domain>/slack/events`
- Set OAuth redirect URL to `https://<your-domain>/slack/oauth_redirect`

### 7. Slack app listing (optional, for wider distribution)

To appear in the Slack App Directory:
- App review by Slack (requires privacy policy, support contact, scopes justification)
- Must pass Slack's security and policy checklist
- Out of scope until the app is stable and production-hardened

---

## Rough implementation order

1. Add database + token storage model
2. Switch Bolt to HTTP mode with `installationStore` pointing at the database
3. Add `/slack/install` and `/slack/oauth_redirect` routes
4. Update env vars (add CLIENT_ID/SECRET, remove static BOT_TOKEN/APP_TOKEN)
5. Deploy to a server with a real domain
6. Update Slack app settings (Request URL, OAuth Redirect URL, Interactivity URL)
7. Test end-to-end install from a fresh workspace
8. (Later) GitHub App integration for per-workspace GitHub tokens

---

## Files that will need changes

| File | Change |
|---|---|
| `src/slack/slack.service.ts` | HTTP mode Bolt config, `installationStore`, per-team token lookup |
| `src/slack/slack.module.ts` | Inject database service |
| `src/common/config/env.validation.ts` | Replace BOT/APP tokens with CLIENT_ID/SECRET |
| `src/main.ts` | Mount Slack event receiver on HTTP route |
| New: `src/database/` | Database module, installation entity/model, repository |
| `README.md` | Updated setup guide for multi-tenant deploy |
| `.env.example` | Updated env vars |

---

## Out of scope for now

- GitHub OAuth per workspace (Option B above)
- Slack App Directory submission
- Multi-region or high-availability infra
- Per-workspace config UI
