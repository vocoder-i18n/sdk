# GitHub Actions Setup

Vocoder translations are triggered by a GitHub Action that runs on every push. The Action extracts strings, requests translations, and commits locale JSON files back to the repository.

## Workflow file

`vocoder init` writes `.github/workflows/vocoder-translate.yml` automatically. If setting up manually:

```yaml
name: Vocoder Translate
on:
  push:
    branches: [main]   # replace with your targetBranches
jobs:
  translate:
    runs-on: ubuntu-latest
    if: github.actor != 'vocoder-bot[bot]'
    permissions:
      contents: write
      pull-requests: write   # omit when commit-mode is direct
    steps:
      - uses: actions/checkout@v4
      - uses: vocoder-i18n/translate-action@v1
        with:
          api-key: ${{ secrets.VOCODER_API_KEY }}
          commit-mode: pr     # or "direct"
          on-failure: proceed
```

The `if: github.actor != 'vocoder-bot[bot]'` filter prevents a loop when Vocoder commits locale files back to the branch.

The `branches` list should match the branches you configured during `vocoder init`.

## Commit mode

| `commit-mode` | Behavior | Permissions needed |
|---|---|---|
| `pr` (default) | Opens a pull request with updated locale files | `contents: write`, `pull-requests: write` |
| `direct` | Pushes locale files directly to the target branch | `contents: write` |

Choose `pr` when you want to review translation changes before merging. Choose `direct` for CI pipelines where immediate application is preferred.

## Repository secret

Add `VOCODER_API_KEY` as a GitHub repository secret:
GitHub repo → Settings → Secrets and variables → Actions → New repository secret
- Name: `VOCODER_API_KEY`
- Value: the key printed by `vocoder init` (starts with `vcp_`)

## Commit the workflow file

```bash
git add .github/workflows/vocoder-translate.yml
git commit -m "Add Vocoder translate workflow"
git push
```

## How it works

1. Developer pushes to a target branch
2. GitHub Action runs `@vocoder/cli translate`
3. CLI extracts strings, submits to Vocoder API, polls until translations are ready
4. Action commits `locales/manifest.json` and `locales/{locale}.json` files to the repository (via PR or direct push depending on `commit-mode`)
5. Provider reads the committed files at runtime — no rebuild required to pick up new translations

## Failure behavior

By default the action proceeds even if translation fails — the build continues with stale or source-language strings.

To halt on translation failure, use the `on-failure` input:

```yaml
- uses: vocoder-i18n/translate-action@v1
  with:
    api-key: ${{ secrets.VOCODER_API_KEY }}
    commit-mode: pr
    on-failure: fail
```

## Pinning the action version

```yaml
- uses: vocoder-i18n/translate-action@v1        # latest v1 (recommended)
- uses: vocoder-i18n/translate-action@v1.0.0    # pinned exact version
```

## Monorepo setup

For repos with multiple apps, declare app directories in `vocoder.config.ts` at the repo root — no YAML input needed:

```ts
// vocoder.config.ts
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  targetBranches: ['main'],
  apps: [
    { appDir: 'apps/web' },
    { appDir: 'apps/admin' },
  ],
});
```

Each app gets its own locale directory:
- `apps/web/locales/manifest.json`, `apps/web/locales/{locale}.json`
- `apps/admin/locales/manifest.json`, `apps/admin/locales/{locale}.json`

App records are created lazily on first run. Per-app fields (`localesDir`, `targetBranches`, `include`, `exclude`, `formality`, `industry`) can be overridden per entry and are merged over the root-level defaults.

For single-app repos, omit `apps` entirely.
