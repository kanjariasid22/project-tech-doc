# How it works & how to set it up

## What this does

You paste a GitHub PR link into Slack. The bot:

1. Fetches the PR diff and commits from GitHub
2. Runs it through Gemini to understand what changed and why
3. Calls you on a short AI voice call (ElevenLabs) to ask a few clarifying questions
4. Writes a technical doc + a plain-language user guide based on the diff and your answers
5. Posts both drafts in Slack for you to review
6. On your approval, commits both files to your repo under `docs/`

If the module already has docs, it updates them coherently instead of appending a new section.

---

## The trigger

In any Slack channel the bot is in, type:

```
document #PR-42 https://github.com/your-org/your-repo/pull/42
```

---

## What you'll see

| Step | Slack message |
|---|---|
| Trigger received | `👋 Got it! Working on PR #42` |
| PR fetched | `📥 Fetched PR #42 — "Your PR title"` |
| Voice call link sent | A link to join a 2-minute AI voice chat |
| Docs drafted | `📝 Got your answers — writing the docs now…` |
| Draft ready | Two `.md` files uploaded + **Approve & Commit** / **Reject** buttons |
| Approved | `✅ Committed docs for PR #42` |
| Rejected | `🗑️ Discarded draft` |
| No action in 30 min | `⌛ Preview expired` |

---

## Setup

### Step 1 — Clone and install

```bash
git clone <this repo>
cd project-tech-doc
npm install
cp .env.example .env
```

### Step 2 — Fill in `.env`

Open `.env` and fill in all six values:

```
GEMINI_API_KEY=        # from aistudio.google.com/apikey
ELEVENLABS_API_KEY=    # from elevenlabs.io/app/settings/api-keys
SLACK_BOT_TOKEN=       # xoxb-... from your Slack app
SLACK_SIGNING_SECRET=  # from Slack app → Basic Information
SLACK_APP_TOKEN=       # xapp-... from Slack app → App-Level Tokens
GITHUB_TOKEN=          # personal access token with repo scope
```

### Step 3 — Create a Slack app

Go to [api.slack.com/apps](https://api.slack.com/apps) → Create New App → From scratch.

Enable these in the sidebar:

- **Socket Mode** → toggle ON → create an App-Level Token with `connections:write` scope → paste it as `SLACK_APP_TOKEN`
- **Interactivity & Shortcuts** → toggle ON (required for the Approve/Reject buttons)
- **OAuth & Permissions** → add these Bot Token Scopes:
  - `chat:write`
  - `files:write`
  - `channels:history`
  - `groups:history`
  - `im:history`
- **Event Subscriptions** → toggle ON → Subscribe to bot events:
  - `message.channels`
  - `message.groups`
  - `message.im`

Install the app to your workspace → copy the `Bot User OAuth Token` → paste as `SLACK_BOT_TOKEN`.

Invite the bot into a channel: `/invite @your-bot-name`

### Step 4 — Run

```bash
npm run start:dev
```

You should see:

```
[Bootstrap] Ready — listening on http://localhost:3000
[SlackService] Slack app connected via Socket Mode
```

Then post the trigger in Slack and watch it go.

---

## Where docs land

Both files are committed to the **target repo** (the one whose PR you triggered on):

```
docs/technical/<module-name>.md   ← technical writeup
docs/guides/<module-name>.md      ← plain-language user guide
```

The module name is derived from the affected modules Gemini identifies in the PR.
