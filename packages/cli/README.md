# @vocoder/cli

Command-line tool for Vocoder. Handles project setup, string extraction, and translation sync.

## Installation

```bash
npm install -g @vocoder/cli
```

Or use without installing:

```bash
npx @vocoder/cli <command>
```

## Commands

### `vocoder init`

Connect your repository to Vocoder. Runs an interactive TUI that handles authentication, workspace setup, and project configuration — all in the terminal. Only one browser step is required (Vocoder sign-in), and only on first run.

```bash
vocoder init
```

**First-time setup:**

The CLI opens the Vocoder sign-in page. After authenticating, your workspace is ready and the CLI writes your API key and a GitHub Actions workflow file.

**Returning user (stored credentials):**

**Returning user (stored credentials):**

No browser opens. The stored token is verified and the flow continues in the terminal.

```
┌  Vocoder Setup

◇  Authenticated as user@example.com

◆  Select workspace
│  ● my-workspace  (3 projects)
│  ○ + Create new workspace
```

**GitHub Actions workflow:**

After `vocoder init` completes, it writes `.github/workflows/vocoder.yml` automatically. Add `VOCODER_API_KEY` as a GitHub repository secret (Settings → Secrets and variables → Actions → New repository secret, name: `VOCODER_API_KEY`). Then commit the workflow file:

```bash
git add .github/workflows/vocoder.yml
git commit -m "Add Vocoder translate workflow"
git push
```

Example workflow (branches templated from your `targetBranches` answer during init):

```yaml
name: Vocoder Translate
on:
  push:
    branches: [main]
jobs:
  translate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vocoder-i18n/translate-action@v1
        with:
          api-key: ${{ secrets.VOCODER_API_KEY }}
```

**Monorepo support:**

When running `vocoder init` from a subdirectory of a git repository, the CLI automatically suggests that subdirectory as the app directory. Each app in a monorepo should be set up as a separate Vocoder project.

**Options:**

| Flag | Description |
|---|---|
| `--yes` | Skip the "Open in your browser?" confirmation |
| `--ci` | Non-interactive mode. Prints `VOCODER_AUTH_URL: <url>` to stdout instead of opening a browser. Intended for CI environments where the browser step is driven externally. |

**Stored credentials:**

After first sign-in, the CLI stores credentials at `~/.vocoder/auth.json` (mode `0600`). Tokens do not expire. Use `vocoder logout` to revoke.

**Token resolution:**

| Command | Source |
|---|---|
| `vocoder init` | `VOCODER_AUTH_TOKEN` env var → `~/.vocoder/auth.json` |
| `vocoder translate` | `VOCODER_API_KEY` env var → `.env` file |
| MCP tools | `VOCODER_API_KEY` env var |

---

### `vocoder translate`

Extract translatable strings from your source code and submit them for translation. This is the command the GitHub Action calls — you can also run it locally to test before pushing.

```bash
vocoder translate
```

Reads `VOCODER_API_KEY` from environment or `.env`. Detects `<T>` and `t()` usages, submits them to Vocoder, and polls until translations are returned.

**Options:**

| Flag | Description |
|---|---|
| `--branch <name>` | Git branch (auto-detected from git/CI env vars if omitted) |
| `--commit-sha <sha>` | Commit SHA (auto-detected from CI env vars if omitted) |
| `--dry-run` | Show what would be submitted without sending |
| `--verbose` | Show extraction and submission details |

---

## Project Management

These commands operate on an existing Vocoder project and require `VOCODER_API_KEY` in your environment (set it in `.env` or export it before running).

### `vocoder locales`

Show the project's configured source locale and all target locales.

```bash
vocoder locales
# Source locale:  en
# Target locales: fr, de, pt-BR
```

#### `vocoder locales add <codes...>`

Add one or more target locales to the project. Accepts variadic BCP 47 codes.

```bash
vocoder locales add fr
vocoder locales add fr de pt-BR
```

Returns an error with an upgrade link if the plan's locale limit is reached.

#### `vocoder locales remove <codes...>`

Remove one or more target locales from the project. Idempotent — silently skips locales that are not configured.

```bash
vocoder locales remove fr
vocoder locales remove de pt-BR
```

#### `vocoder locales supported`

List all locales supported by Vocoder. Useful for finding BCP 47 codes before calling `add`.

```bash
vocoder locales supported
# Source locales:
#   en         English
#   ...
# Target locales:
#   ar         Arabic (العربية)
#   de         German (Deutsch)
#   es         Spanish (Español)
#   fr         French (Français)
#   ...
```

---

### `vocoder project`

Display the full project configuration: name, organization, source locale, target locales, target branches, and sync policy.

```bash
vocoder project
# ╭─ My App — project config ────────────────────╮
# │ Project:         My App                       │
# │ Organization:    Acme Corp                    │
# │ Source locale:   en                           │
# │ Target locales:  fr, de, pt-BR                │
# │ Target branches: main                         │
# │ Primary branch:  main                         │
# │ Sync policy:                                  │
# │   Blocking branches: main, master             │
# │   Blocking mode:     required                 │
# │   Non-blocking mode: best-effort              │
# │   Max wait:          60000 ms                 │
# ╰───────────────────────────────────────────────╯
```

---

### `vocoder translations`

Download the current translation snapshot for a branch.

```bash
vocoder translations
vocoder translations --branch main --locale fr
vocoder translations --output ./public/locales
```

Without `--output`, prints the full snapshot as JSON to stdout (suitable for piping). With `--output <dir>`, writes one `<locale>.json` file per locale to the specified directory. Each file shape:

```json
{
  "Hello": "Bonjour",
  "Goodbye": "Au revoir"
}
```

**Options:**

| Flag | Description |
|---|---|
| `--branch <branch>` | Git branch (auto-detected from git/CI if omitted) |
| `--locale <locale>` | Fetch a single locale only |
| `--output <dir>` | Write locale JSON files to this directory |

---

### `vocoder create-project`

Create a new Vocoder project without the interactive `init` flow. Requires authentication (run `vocoder init` first).

```bash
vocoder create-project \
  --name "My App" \
  --source-locale en \
  --target-locales fr,de,pt-BR \
  --target-branches main \
  --workspace <org-id>
```

On success, prints the generated `VOCODER_API_KEY`. The organization ID can be found with `vocoder whoami`.

Git repository is auto-detected from the current directory's git remote. Use `--repo github:owner/repo` to override, or omit to create the project without repo binding (push-based sync will not function until a repository is connected via the dashboard).

**Options:**

| Flag | Description |
|---|---|
| `--name <name>` | Project display name (required) |
| `--source-locale <code>` | Source language BCP 47 code, e.g. `en` (required) |
| `--workspace <org-id>` | Organization ID (required) |
| `--target-locales <codes>` | Comma-separated target locale codes, e.g. `fr,de,pt-BR` |
| `--target-branches <names>` | Comma-separated branch names to sync (default: `main`) |
| `--repo <canonical>` | Git repo canonical, e.g. `github:owner/repo` |
| `--app-dir <path>` | App directory within the repo for monorepos (default: `.`) |

---

### `vocoder logout`

Revoke the stored credentials and clear `~/.vocoder/auth.json`.

```bash
vocoder logout
```

The token is also revoked server-side.

---

### `vocoder whoami`

Print the currently authenticated user.

```bash
vocoder whoami
# Authenticated as user@example.com (my-workspace)
```

---

## How `init` interacts with the browser

`vocoder init` opens exactly one browser window, and only on first run. The browser is used to sign in to your Vocoder account (email/password or OAuth). After sign-in, the CLI receives a CLI-scoped token automatically via a local callback server and stores it at `~/.vocoder/auth.json` (mode `0600`). The rest of setup happens in the terminal.

On subsequent runs, the stored token is used directly and no browser is needed.

---

## Git Integration

The CLI auto-detects repository context from the working directory:

- **Repository:** Reads the git remote URL and normalizes it to `github:owner/repo`
- **Branch:** Checks CI environment variables first (GitHub Actions, Vercel, Netlify, etc.), then falls back to `.git/HEAD`
- **App directory:** For monorepos, computes the relative path from the git root to `process.cwd()`

---

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `VOCODER_API_KEY` | `translate`, `locales`, `project`, `translations`, MCP | Project API key (`vca_` prefix) |
| `VOCODER_AUTH_TOKEN` | `init` | Override stored user token (`vcu_` prefix) |
| `VOCODER_API_URL` | All commands | Override API base URL (default: `https://vocoder.app`) |

---

## License

MIT
