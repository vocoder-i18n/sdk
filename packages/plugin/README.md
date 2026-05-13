# @vocoder/plugin

Build plugin for Vocoder that fetches translations at build time and injects them as virtual modules. Works with Vite, Next.js, Webpack, Rollup, and esbuild.

## Installation

```bash
npm install @vocoder/plugin
```

## Setup

### Vite

```ts
// vite.config.ts
import vocoder from '@vocoder/plugin/vite';

export default defineConfig({
  plugins: [vocoder()],
});
```

### Next.js

```js
// next.config.js
const { withVocoder } = require('@vocoder/plugin/next');

module.exports = withVocoder({
  // your Next.js config
});
```

### Webpack

```js
// webpack.config.js
const vocoder = require('@vocoder/plugin/webpack');

module.exports = {
  plugins: [vocoder()],
};
```

### Rollup

```js
// rollup.config.js
import vocoder from '@vocoder/plugin/rollup';

export default {
  plugins: [vocoder()],
};
```

### esbuild

```js
import vocoder from '@vocoder/plugin/esbuild';

await esbuild.build({
  plugins: [vocoder()],
});
```

---

## Configuration

All options are optional. Pass them to the plugin factory:

```ts
// vite.config.ts
import vocoder from '@vocoder/plugin/vite';

export default defineConfig({
  plugins: [
    vocoder({
      // Glob patterns for files to scan for translatable strings.
      // Default: ["**/*.{tsx,jsx,ts,js}"]
      include: ['src/**/*.{tsx,jsx}'],

      // Additional glob patterns to exclude. Always merged with built-in
      // excludes (node_modules, dist, build, .next, .nuxt, etc.).
      exclude: ['**/*.stories.tsx', 'src/mocks/**'],
    }),
  ],
});
```

| Option | Type | Default | Description |
|---|---|---|---|
| `include` | `string \| string[]` | `["**/*.{tsx,jsx,ts,js}"]` | Files to scan for `<T>` and `t()` calls |
| `exclude` | `string \| string[]` | — | Extra patterns to skip (merged with built-in excludes) |

---

## How It Works

The plugin runs at build time and performs the following steps:

1. **Detects your repository** from CI environment variables (`GITHUB_REPOSITORY`, `VERCEL_GIT_REPO_OWNER`, `CI_PROJECT_PATH`, etc.) or by reading `.git/config` and parsing the origin remote URL into a canonical format (`github:owner/repo`, `gitlab:owner/repo`, etc.).

2. **Detects the commit SHA** from CI environment variables. Variables checked in order: `VOCODER_COMMIT_SHA`, `GITHUB_SHA`, `VERCEL_GIT_COMMIT_SHA`, `CI_COMMIT_SHA`, `BITBUCKET_COMMIT`, `CIRCLE_SHA1`, `RENDER_GIT_COMMIT`. Falls back to reading the SHA from `.git/refs/heads/<branch>` or `.git/packed-refs`.

3. **Computes a content fingerprint** — a 12-character hex string derived from `sha256(projectShortId + ":" + appDir + ":" + sortedKeys)`. This identifies the exact translation bundle for the current string set.

4. **Fetches the translation bundle** from the Vocoder CDN using the fingerprint, returning all locales in a single response.

5. **Inlines the bundle** via `__VOCODER_BUNDLE__` — the full `VocoderTranslationData` JSON is injected as a compile-time constant. No virtual modules, no runtime fetches required for client bundles. SSR falls back to reading `node_modules/.vocoder/cache/{fingerprint}.json` from disk.

6. **Enables dev-mode auto-sync** — in `NODE_ENV=development`, if no bundle exists for the current strings, the plugin submits them to the Vocoder API and polls until translations are ready. Build proceeds immediately; translations appear on the next hot-reload.

---

## Zero Configuration

No configuration files or environment variables are required for basic use. Repository identity, branch, and commit SHA are all auto-detected. `include`/`exclude` options are available for non-standard project layouts.

---

## Offline Fallback

Translations are cached to `node_modules/.vocoder/cache/` after each successful build. If the Vocoder API is unreachable on a subsequent build, the cached translations are used. If no cache exists, the build proceeds with empty translations and source text is shown.

---

## Monorepo Support

In a monorepo, run the plugin from each app's build step. The plugin computes a scope path (the relative path from the git root to `process.cwd()`) and includes it in the fingerprint, ensuring each app fetches its own translations independently.

---

## Build Output

During the build, the plugin logs:

```
[vocoder] github:owner/repo @ a1b2c3d4 -> e5f6a7b8c9d0
[vocoder] Loaded 3 locale(s), 42 translation(s)
```

Local development fallback (no commit SHA):

```
[vocoder] Could not detect commit SHA — using branch name for fingerprint (local dev mode).
[vocoder] github:owner/repo @ main (branch) -> a1b2c3d4e5f6
```

Before first sync:

```
[vocoder] No translations available yet -- source text will be shown.
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `VOCODER_COMMIT_SHA` | Override the detected commit SHA. Useful if your CI uses a non-standard variable name. |
| `VOCODER_FINGERPRINT` | Override the computed fingerprint entirely. For environments with no git context and no CI variables. |
| `VOCODER_API_URL` | Override the Vocoder API base URL (default: `https://vocoder.app`). |

---

## License

MIT
