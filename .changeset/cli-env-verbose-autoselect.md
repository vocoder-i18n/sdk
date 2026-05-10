---
"@vocoder/cli": minor
---

Add verbose mode, .env.local support, and smarter GitHub installation auto-select.

- `vocoder init --verbose`: logs each API request URL and response status; previews response body on errors. Useful for debugging custom `--api-url` setups
- All commands now load both `.env` and `.env.local` from CWD and the git root (monorepo support). Shell env always wins. Fixes setups where `VOCODER_API_URL` was in `.env.local` and silently ignored
- API keys are now written to `.env.local` (prefers existing `.env.local`, falls back to `.env`, creates `.env.local` if neither exists)
- GitHub installation prompt is skipped when the repo owner matches exactly one installation — the right account is selected automatically. Shows a warning when no installation covers the current repo's owner
