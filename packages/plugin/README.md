# @vocoder/plugin

Build plugin for Vocoder. Works with Vite, Next.js, Webpack, Rollup, and esbuild.

## Installation

```bash
npm install @vocoder/plugin
```

## Setup

### Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vocoder from '@vocoder/plugin/vite'

export default defineConfig({
  plugins: [react(), vocoder()],
})
```

### Next.js

```ts
// next.config.ts
import { withVocoder } from '@vocoder/plugin/next'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {}

export default withVocoder(nextConfig)
```

### Webpack

```js
// webpack.config.js
const { VocoderPlugin } = require('@vocoder/plugin/webpack')

module.exports = {
  plugins: [new VocoderPlugin()],
}
```

### Rollup

```js
// rollup.config.js
import vocoder from '@vocoder/plugin/rollup'

export default {
  plugins: [vocoder()],
}
```

### esbuild

```js
import { build } from 'esbuild'
import { vocoderPlugin } from '@vocoder/plugin/esbuild'

await build({
  plugins: [vocoderPlugin()],
})
```

---

## Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `localesDir` | `string` | `'locales'` | Path to locale files, relative to `process.cwd()` |
| `verbose` | `boolean` | `false` | Log manifest loading details during build |
| `preview` | `boolean` | `false` | Build in preview mode — SDK shows source text and disables locale switching |

```ts
vocoder({ localesDir: 'src/locales', verbose: true })
```

---

## How It Works

The plugin performs three tasks at build time:

### 1. Injects the locale manifest

Reads `localesDir/manifest.json` and injects its contents as `__VOCODER_MANIFEST__` — a compile-time constant the SDK reads to determine available locales, the source locale, and per-locale metadata (RTL flag, currency code, ordinal forms).

### 2. Generates a virtual locale loader

Intercepts `@vocoder/react/locale-loader` at build time and replaces it with a generated module containing a static switch statement:

```js
// Generated at build time — one case per locale file found in localesDir
export async function loadLocale(locale) {
  switch (locale) {
    case 'en': return import('/abs/path/locales/en.json').then(m => m.default ?? m)
    case 'es': return import('/abs/path/locales/es.json').then(m => m.default ?? m)
    case 'fr': return import('/abs/path/locales/fr.json').then(m => m.default ?? m)
    default:   return {}
  }
}
```

Static string imports allow every bundler to analyze them and split each locale into its own lazy chunk. Only the active locale is loaded at runtime — the others are fetched on demand when the user switches.

Without the plugin, `@vocoder/react/locale-loader` resolves to a stub that returns `{}`.

### 3. Transforms JSX

Transforms natural `<T>` syntax into explicit `message`, `values`, and `components` props:

```tsx
// You write:
<T>Hello {name}!</T>
<T>Read <a href="/docs">the docs</a> for help.</T>

// Plugin transforms to:
<T message="Hello {name}!" values={{ name }}>Hello {name}!</T>
<T message="Read <0>the docs</0> for help." components={[<a href="/docs" />]}>
  Read <a href="/docs">the docs</a> for help.
</T>
```

---

## Injected Constants

| Constant | Type | Description |
|---|---|---|
| `__VOCODER_MANIFEST__` | `LocaleManifest \| null` | Contents of `localesDir/manifest.json`. `null` when the file is missing. |
| `__VOCODER_PREVIEW__` | `boolean` | `true` when built with `preview: true`. |

---

## locales/ Directory

The plugin reads locale files from `localesDir`. These files are committed to your repository by the Vocoder GitHub Action after each translation run.

```
locales/
  manifest.json     # Locale config — written by vocoder CLI
  en.json           # Source locale translations { hash: text }
  es.json           # Target locale translations
  fr.json
```

---

## License

MIT
