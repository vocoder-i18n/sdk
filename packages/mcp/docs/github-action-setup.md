# GitHub Actions Setup

Vocoder translations are triggered by a GitHub Action that runs before the build on every push.

## Workflow file

`vocoder init` writes `.github/workflows/vocoder.yml` automatically. If setting up manually:

```yaml
name: Vocoder Translate
on:
  push:
    branches: [main]   # replace with your targetBranches
jobs:
  translate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: vocoder-i18n/translate-action@v1
        with:
          api-key: ${{ secrets.VOCODER_API_KEY }}
```

The `branches` list must match `targetBranches` in `vocoder.config.ts`.

## Repository secret

Add `VOCODER_API_KEY` as a GitHub repository secret:
GitHub repo → Settings → Secrets and variables → Actions → New repository secret
- Name: `VOCODER_API_KEY`
- Value: the key printed by `vocoder init` (starts with `vcp_`)

## Commit the workflow file

```bash
git add .github/workflows/vocoder.yml
git commit -m "Add Vocoder translate workflow"
git push
```

## How it works

1. Developer pushes to a target branch
2. GitHub Action runs `npx @vocoder/cli translate`
3. CLI extracts strings, submits to Vocoder API, polls until translations are ready
4. Build job runs after — translations are already in the CDN

The action must complete before the build runs. Add `needs: translate` to your build job if they are in separate jobs.

## Failure behavior

By default the action proceeds even if translation fails — the build continues with stale or source-language strings.

To halt the build on translation failure, use the `on-failure` input:

```yaml
- uses: vocoder-i18n/translate-action@v1
  with:
    api-key: ${{ secrets.VOCODER_API_KEY }}
    on-failure: fail
```

Alternatively, set the `VOCODER_ON_FAILURE` environment variable, or configure `onTranslationFailure` in `vocoder.config.ts`:

```typescript
export default defineConfig({
  // ...
  onTranslationFailure: 'fail',
});
```

The `on-failure` action input takes precedence over `VOCODER_ON_FAILURE`, which takes precedence over `vocoder.config.ts`.

## Pinning the action version

```yaml
- uses: vocoder-i18n/translate-action@v1        # latest v1 (recommended)
- uses: vocoder-i18n/translate-action@v1.0.0    # pinned exact version
```

## Monorepo setup

For repos with multiple apps, pass the `app-dirs` input — a comma-separated list of app directories relative to the repo root:

```yaml
- uses: vocoder-i18n/translate-action@v1
  with:
    api-key: ${{ secrets.VOCODER_API_KEY }}
    app-dirs: apps/web,apps/admin
```

Each app directory must contain a `vocoder.config.ts`. Strings are extracted per app and submitted as a single batch. App records are created lazily on first run and deactivated when removed from `app-dirs`.

For single-app repos, omit `app-dirs` entirely.
