# Build Plugin Reference — @vocoder/plugin

The Vocoder build plugin does three things:

1. **Transforms natural JSX syntax** into explicit `message`/`values`/`components` props
2. **Reads `locales/manifest.json`** and injects it as `__VOCODER_MANIFEST__` for the SDK runtime
3. **Registers `@vocoder/locales` as a resolve alias** pointing to your `locales/` directory so the SDK can lazy-load per-locale JSON files

---

## Framework Entry Points

All entry points accept the same options object.

### Next.js

```ts
// next.config.ts
import { withVocoder } from '@vocoder/plugin/next'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // your existing Next.js config
}

export default withVocoder(nextConfig)
```

`withVocoder` registers the Vocoder webpack plugin and configures the `@vocoder/locales` alias for both webpack (production) and Turbopack (Next.js 15.2+ dev).

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

### Webpack (standalone)

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

## Plugin Options

```ts
interface VocoderPluginOptions {
  verbose?: boolean     // Log manifest loading details during build. Default: false
  preview?: boolean     // Enable preview mode (show source strings, disable locale switching). Default: false
  localesDir?: string   // Path to locales directory, relative to process.cwd(). Default: 'locales'
}
```

```ts
// Vite example with options
vocoder({ verbose: true, localesDir: 'apps/web/locales' })

// Next.js example with options
withVocoder(nextConfig, { verbose: true })
```

---

## What the Plugin Transforms

### Natural interpolation syntax

```tsx
// You write:
<T>Hello {name}!</T>

// Plugin transforms to:
<T message="Hello {name}!" values={{ name }}>Hello {name}!</T>
```

The `children` is preserved as fallback (shown while translations load). The `message` becomes the lookup key.

### Natural rich text syntax

```tsx
// You write:
<T>Read <a href="/docs">the docs</a> for help.</T>

// Plugin transforms to:
<T
  message="Read <0>the docs</0> for help."
  components={[<a href="/docs" />]}
>
  Read <a href="/docs">the docs</a> for help.
</T>
```

Each JSX child element becomes a numbered slot (`<0>`, `<1>`, etc.). The element's children become the translatable inner text for that slot.

### Mixed interpolation + rich text

```tsx
// You write:
<T>Hello {name}, read <a href="/docs">the docs</a>.</T>

// Plugin transforms to:
<T
  message="Hello {name}, read <0>the docs</0>."
  values={{ name }}
  components={[<a href="/docs" />]}
>
  Hello {name}, read <a href="/docs">the docs</a>.
</T>
```

### What the plugin does NOT transform

- `<T message="...">` — explicit form, already correct
- `<T value={x} one="..." other="...">` — plural/select shorthand, already correct
- `<T format="...">` — format mode, already correct
- `t()` calls — extracted by the extractor, not transformed by the plugin

---

## Injected Constants

The plugin defines these global constants at build time. The SDK reads them at runtime.

| Constant | Type | Description |
|---|---|---|
| `__VOCODER_MANIFEST__` | `LocaleManifest \| null` | Locale config read from `locales/manifest.json` at build time. Contains `sourceLocale`, `targetLocales`, and per-locale metadata. `null` when manifest is missing. |
| `__VOCODER_PREVIEW__` | `boolean` | `true` in preview mode. SDK shows source text instead of translations. |

---

## Virtual Locale Loader

The plugin intercepts `@vocoder/react/locale-loader` at build time and replaces it with a generated module containing a static switch statement — one case per locale file found in `localesDir`:

```js
// Generated at build time
export async function loadLocale(locale) {
  switch (locale) {
    case 'en': return import('/abs/path/locales/en.json').then(m => m.default ?? m)
    case 'es': return import('/abs/path/locales/es.json').then(m => m.default ?? m)
    case 'fr': return import('/abs/path/locales/fr.json').then(m => m.default ?? m)
    default:   return {}
  }
}
```

Static string imports allow every bundler (Vite, webpack, Rollup, esbuild) to analyze them and code-split each locale into its own lazy chunk. Only the active locale is fetched at runtime.

Without the plugin, `@vocoder/react/locale-loader` resolves to a stub returning `{}` — the SDK renders source text.

**Vite note**: The plugin adds `@vocoder/react/locale-loader` to `optimizeDeps.exclude` so Vite's esbuild pre-bundler treats it as external, preserving the bare specifier in the pre-bundled `@vocoder/react` chunk. Vite's module pipeline then resolves it through the plugin's hooks at serve/build time.

---

## locales/ Directory Structure

The plugin expects your `localesDir` to contain:

```
locales/
  manifest.json        # Written by vocoder CLI after translation
  en.json              # Source locale translations (hash → string)
  fr.json              # Target locale translations
  es.json
  ...
```

`manifest.json` format:

```json
{
  "version": 1,
  "sourceLocale": "en",
  "targetLocales": ["fr", "es"],
  "locales": {
    "en": { "nativeName": "English", "isRTL": false, "currencyCode": "USD" },
    "fr": { "nativeName": "Français", "isRTL": false, "currencyCode": "EUR" }
  },
  "updatedAt": "2026-05-19T00:00:00.000Z",
  "fingerprint": "abc123def456"
}
```

---

## Server Components (Next.js App Router)

`getConfig()` and `getLocales()` read `__VOCODER_MANIFEST__` synchronously. Import them from `@vocoder/react/server` (no `'use client'` boundary) in Server Components:

```ts
// app/layout.tsx (Server Component)
import { cookies } from 'next/headers'
import { VocoderProvider } from '@vocoder/react'
import { getConfig, getLocales, getLocaleDir } from '@vocoder/react/server'

export default async function RootLayout({ children }) {
  const cookieStore = await cookies()
  const initialLocale = cookieStore.get('vocoder_locale')?.value
  const config = getConfig()
  const locale = initialLocale ?? config.sourceLocale ?? 'en'
  const dir = getLocaleDir(locale, getLocales())

  return (
    <html lang={locale} dir={dir}>
      <body>
        <VocoderProvider initialLocale={initialLocale}>
          {children}
        </VocoderProvider>
      </body>
    </html>
  )
}
```

Do **not** import `getConfig` or `getLocales` from `@vocoder/react` (the client entry) — Next.js will throw when a Server Component calls a client-only function.
