# @vocoder/cli

CLI for Vocoder project setup, translation sync, and project management.

## Installation

```bash
npm install -D @vocoder/cli
```

Or run it without installing:

```bash
npx @vocoder/cli <command>
```

## Commands

### `vocoder init`

Authenticate with Vocoder, select a workspace, create or connect a project, optionally install SDK packages, write `VOCODER_API_KEY`, and create the GitHub Actions workflow.

```bash
vocoder init
```

Typical flow:

- Authenticate in the browser on first run
- Select or create a workspace
- Choose app directories for monorepos
- Choose source language, target languages, and trigger branches
- Optionally install `@vocoder/mcp`
- Write `.github/workflows/vocoder-translate.yml`
- Write `VOCODER_API_KEY` into `.env.local` or `.env`

Files written at the repository root:

1. `.github/workflows/vocoder-translate.yml`
2. `.env.local` or `.env`

Options:

| Flag | Description |
|---|---|
| `--api-url <url>` | Override the Vocoder API URL |
| `--yes` | Skip the browser-open confirmation |
| `--ci` | Print `VOCODER_AUTH_URL` and `VOCODER_SESSION_ID` instead of opening the browser |
| `--verbose` | Log API request URLs and response statuses |

### `vocoder translate`

Extract strings, submit them to Vocoder, poll until completion, and write the latest locale files into the git root.

```bash
vocoder translate
vocoder translate --dry-run
vocoder translate --app-dirs apps/web,apps/admin
```

Reads `VOCODER_API_KEY` from the environment or local env files.

Options:

| Flag | Description |
|---|---|
| `--branch <branch>` | Override the detected git branch |
| `--commit-sha <sha>` | Override the detected commit SHA |
| `--dry-run` | Extract and summarize what would be submitted without making API calls |
| `--verbose` | Show extra diagnostics |
| `--api-url <url>` | Override the Vocoder API URL |
| `--app-dirs <dirs>` | Comma-separated app directories for monorepos |

### `vocoder pull`

Fetch the latest compiled locale files for a branch and write them into your project.

```bash
vocoder pull
vocoder pull --branch main
vocoder pull --output ./tmp/vocoder
vocoder pull --app-dirs apps/web,apps/admin
```

Options:

| Flag | Description |
|---|---|
| `--app-dirs <dirs>` | Comma-separated app directories for monorepos |
| `--output <dir>` | Write locale files into this directory instead of the git root |
| `--api-url <url>` | Override the Vocoder API URL |
| `--branch <branch>` | Override the detected git branch |

### `vocoder locales`

Show the configured source locale and target locales for the current project.

```bash
vocoder locales
```

### `vocoder locales add <codes...>`

Add one or more target locales.

```bash
vocoder locales add fr
vocoder locales add fr de pt-BR
```

### `vocoder locales remove <codes...>`

Remove one or more target locales.

```bash
vocoder locales remove fr
vocoder locales remove de pt-BR
```

### `vocoder locales supported`

List all locales supported by Vocoder.

```bash
vocoder locales supported
```

### `vocoder config`

Show the current project configuration.

```bash
vocoder config
```

### `vocoder create-project`

Create a project without running the interactive `init` flow. Requires prior authentication.

```bash
vocoder create-project \
  --name "My App" \
  --source-locale en \
  --organization <org-id> \
  --target-locales fr,de \
  --target-branches main
```

Options:

| Flag | Description |
|---|---|
| `--name <name>` | Project display name |
| `--source-locale <code>` | Source language BCP 47 code |
| `--organization <org-id>` | Workspace ID |
| `--target-locales <codes>` | Comma-separated target locale codes |
| `--target-branches <branches>` | Comma-separated trigger branches |
| `--repo <canonical>` | Override the detected git repo canonical, for example `github:owner/repo` |
| `--api-url <url>` | Override the Vocoder API URL |

### `vocoder regenerate-key`

Generate a new project API key for the current repository.

```bash
vocoder regenerate-key
```

### `vocoder whoami`

Show the currently authenticated user.

```bash
vocoder whoami
```

### `vocoder logout`

Revoke stored credentials and clear `~/.vocoder/auth.json`.

```bash
vocoder logout
```

## Authentication

`vocoder init` opens the browser only when authentication is needed. After that, credentials are stored in:

```text
~/.vocoder/auth.json
```

Use `vocoder logout` to revoke and clear them.

## Environment Variables

| Variable | Used by | Purpose |
|---|---|---|
| `VOCODER_API_KEY` | `translate`, `pull`, `locales`, `config` | Project API key |
| `VOCODER_AUTH_TOKEN` | `init` | Override the stored user token |
| `VOCODER_ON_FAILURE` | `translate` | Override `onTranslationFailure` with `fail` or `proceed` |
| `VOCODER_API_URL` | All commands | Override the API base URL |

## License

MIT
