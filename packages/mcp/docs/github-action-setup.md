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
- Value: the key printed by `vocoder init` (starts with `vca_`)

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

By default (`onTranslationFailure: 'proceed'`), a failed translation prints a warning and the build continues. To halt the build on translation failure, add to `vocoder.config.ts`:

```typescript
export default defineConfig({
  // ...
  onTranslationFailure: 'fail',
});
```

## Pinning the action version

```yaml
- uses: vocoder-i18n/translate-action@v1        # latest v1 (recommended)
- uses: vocoder-i18n/translate-action@v1.0.0    # pinned exact version
```

## Multi-app repos

Use `working-directory` if `vocoder.config.ts` is not at the repo root:

```yaml
- uses: vocoder-i18n/translate-action@v1
  with:
    api-key: ${{ secrets.VOCODER_API_KEY }}
    working-directory: apps/web
```
