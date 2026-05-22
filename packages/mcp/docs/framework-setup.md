# Setup Guide: SSR vs SPA

Vocoder works in both client-side SPAs and server-rendered apps. The key difference is how locale is detected on first render to avoid a flash of the wrong language.

---

## SPA (Vite, CRA, plain React)

No SSR, no cookies needed. Provider reads locale from cookie storage client-side.

### Vite setup

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import vocoder from '@vocoder/plugin/vite'

export default defineConfig({
  plugins: [react(), vocoder()],
})
```

### Approach 1: Bootstrap singleton before mount (recommended)

Initialize the `vocoder` singleton with your manifest and loader, activate the source locale, then mount React. `VocoderProvider` with no props subscribes to this singleton automatically.

```tsx
// src/main.tsx
import { vocoder, VocoderProvider } from '@vocoder/react'
import manifest from '../locales/manifest.json'
import { loadLocale } from '../locales/loader.js'

vocoder.load(manifest, loadLocale)
vocoder.activate(manifest.sourceLocale).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <VocoderProvider>
        <App />
      </VocoderProvider>
    </React.StrictMode>
  )
})
```

`vocoder.activate()` loads the active locale's translation chunk before React mounts. Subsequent locale changes call `vocoder.activate(locale)` via `setLocale` inside the provider.

**Result:** React mounts with translations already in memory. No flash of untranslated content.

**Trade-off:** Blank page while the locale chunk loads. For users on the source locale, `activate()` resolves from the seeded data — near-instant. Only non-source-locale users wait for the import, and it's one dynamic import — fast.

**This is the recommended SPA pattern.**

Optional: show a minimal native spinner while the bootstrap runs:

```tsx
const spinner = document.getElementById('loading-spinner')
vocoder.load(manifest, loadLocale)
vocoder.activate(manifest.sourceLocale).then(() => {
  spinner?.remove()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <VocoderProvider><App /></VocoderProvider>
  )
})
```

### Approach 2: Mount immediately, use `isReady` for loading state

```tsx
// src/main.tsx — no await, mount instantly
ReactDOM.createRoot(document.getElementById('root')!).render(
  <VocoderProvider>
    <App />
  </VocoderProvider>
)
```

```tsx
// src/App.tsx — gate content on isReady
function Layout({ children }) {
  const { isReady } = useVocoder()
  if (!isReady) return <AppSkeleton />
  return <>{children}</>
}
```

`isReady` is `false` during async init inside `VocoderProvider`, `true` once translations for the active locale are loaded.

**Trade-off:** First paint is faster (React mounts immediately), but without a skeleton you'd briefly see source text. With a skeleton this is equivalent to Approach 1 in perceived UX, with slightly more code.

**Use this approach when:** you want more control over the loading state — e.g. a branded splash screen, per-section loading states, or when mounting React itself has significant cost you don't want to defer.

### Approach 3: Mount immediately, show source text during load (simplest)

```tsx
// src/main.tsx
ReactDOM.createRoot(document.getElementById('root')!).render(
  <VocoderProvider><App /></VocoderProvider>
)
// No isReady gate, no await
```

**Result:** Users briefly see source text (English), then it updates to their locale once the bundle loads. For translation bundles served from Cloudflare CDN this gap is typically imperceptible. Acceptable for apps where most users are on the source locale.

**Avoid for:** RTL locales — a flash of LTR layout before switching to RTL is jarring.

### CDN fallback path

The above applies to **build-time bundled translations** (the normal case — the GitHub Action ran `vocoder translate` before the build). If the build couldn't fetch translations (API unreachable, first deploy), `VocoderProvider` falls back to fetching from the Vocoder CDN after mount. This is a real network call, not a bundled chunk.

In that case:
- `await initializeVocoder()` still resolves quickly — it only awaits the manifest + bundled loaders
- The CDN refresh happens inside `VocoderProvider` after mount, independently
- `isReady` will be `false` until the CDN response arrives
- Use Approach 2 (`isReady` gate) if you need to handle this gracefully

The CDN fallback is a safety net, not the primary path. Push to a target branch — the GitHub Action extracts and translates automatically. To test locally, run `npx @vocoder/cli translate`.

```tsx
// src/App.tsx
import { LocaleSelector } from '@vocoder/react/locale-selector'
import { T } from '@vocoder/react'

export default function App() {
  return (
    <>
      <LocaleSelector position="bottom-right" />
      <h1><T>Welcome</T></h1>
    </>
  )
}
```

**Locale persistence:** stored in `vocoder_locale` cookie, 1-year expiry. On return visit, provider reads cookie and loads the previously selected locale automatically.

---

## Next.js App Router

Most involved setup — server components can't use context, so the pattern requires a client `Providers` wrapper that receives the cookie string from the server layout.

### 1. Build plugin

```ts
// next.config.ts
import { withVocoder } from '@vocoder/plugin/next'
export default withVocoder({})
```

### 2. Root layout

`VocoderProvider` is a Client Component but can be rendered directly from a server component — the server reads cookies and passes them as plain props:

```tsx
// app/layout.tsx
import { cookies } from 'next/headers'
import { getConfig, getLocales, VocoderProvider } from '@vocoder/react'
import { getLocaleDir } from '@vocoder/react/server'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const initialLocale = cookieStore.get('vocoder_locale')?.value
  const preview = cookieStore.get('vocoder_preview')?.value === 'true'
  const { sourceLocale } = getConfig()
  const locale = initialLocale ?? sourceLocale
  const dir = getLocaleDir(locale, getLocales())

  return (
    <html lang={locale} dir={dir}>
      <body>
        <VocoderProvider initialLocale={initialLocale} preview={preview}>
          {children}
        </VocoderProvider>
      </body>
    </html>
  )
}
```

### 3. Server components (RSC pages)

Server components use `<T>` directly — locale context comes from the client `VocoderProvider` in the layout.

```tsx
// app/dashboard/page.tsx — server component, no special setup
import { T } from '@vocoder/react'

export default function DashboardPage() {
  return (
    <main>
      <h1><T>Dashboard</T></h1>
      <p><T>Welcome back!</T></p>
    </main>
  )
}
```

### 5. Client components

```tsx
// app/dashboard/settings.tsx
'use client'
import { T, useVocoder } from '@vocoder/react'

export function Settings() {
  const { locale, setLocale } = useVocoder()
  return (
    <div>
      <T>Settings</T>
      <button onClick={() => setLocale('es')}><T>Switch to Spanish</T></button>
    </div>
  )
}
```

### How hydration works

`VocoderProvider` injects a `<script type="application/json">` tag into the HTML with the locale + translations snapshot. The client reads this on mount to avoid a round-trip before first render. This eliminates locale flash on SSR pages.

---

## Next.js Pages Router

```ts
// next.config.js
const { withVocoder } = require('@vocoder/plugin/next')
module.exports = withVocoder({})
```

```tsx
// pages/_app.tsx
import type { AppProps } from 'next/app'
import { VocoderProvider } from '@vocoder/react'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <VocoderProvider initialLocale={pageProps.initialLocale} preview={pageProps.preview}>
      <Component {...pageProps} />
    </VocoderProvider>
  )
}

App.getInitialProps = async ({ ctx }) => {
  const cookie = ctx.req?.headers.cookie ?? ''
  return {
    pageProps: {
      initialLocale: cookie.match(/vocoder_locale=([^;]+)/)?.[1],
      preview: /vocoder_preview=true/.test(cookie),
    },
  }
}
```

```tsx
// pages/index.tsx
import { T } from '@vocoder/react'

export default function Home() {
  return <h1><T>Welcome</T></h1>
}
```

---

## Remix

```ts
// vite.config.ts (Remix uses Vite)
import vocoder from '@vocoder/plugin/vite'
plugins: [remix(), vocoder()]
```

```tsx
// app/root.tsx
import { VocoderProvider } from '@vocoder/react'

export default function App() {
  return (
    <html>
      <head>...</head>
      <body>
        <VocoderProvider>
          <Outlet />
        </VocoderProvider>
      </body>
    </html>
  )
}
```

For Remix with SSR locale detection, read the cookies from the request in a loader and pass `initialLocale` and `preview` to the provider:

```tsx
export async function loader({ request }: LoaderFunctionArgs) {
  const cookie = request.headers.get('Cookie') ?? ''
  return json({
    initialLocale: cookie.match(/vocoder_locale=([^;]+)/)?.[1],
    preview: /vocoder_preview=true/.test(cookie),
  })
}

export default function App() {
  const { initialLocale, preview } = useLoaderData<typeof loader>()
  return (
    <html>
      <body>
        <VocoderProvider initialLocale={initialLocale} preview={preview}>
          <Outlet />
        </VocoderProvider>
      </body>
    </html>
  )
}
```

---

## Manifest Props Mode (no build plugin)

When you pass `manifest` + `loadLocale` directly to `VocoderProvider`, the provider creates an isolated `VocoderCore` instance internally. No build plugin or singleton bootstrap needed. The Vocoder CLI still runs sync and extraction.

### File layout

```
src/
  locales/
    manifest.json    # generated by `vocoder translate`
    en.json          # source locale translations
    es.json          # target locale translations
    ...
```

### Vite / SPA

```tsx
// src/main.tsx
import manifest from './locales/manifest.json'
import { VocoderProvider } from '@vocoder/react'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <VocoderProvider
    manifest={manifest}
    loadLocale={(locale) => import(`./locales/${locale}.json`).then(m => m.default)}
  >
    <App />
  </VocoderProvider>
)
```

### Next.js App Router

```tsx
// app/layout.tsx (Server Component)
import { cookies } from 'next/headers'
import manifest from '../locales/manifest.json'
import { VocoderProvider } from '@vocoder/react'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies()
  const initialLocale = cookieStore.get('vocoder_locale')?.value ?? manifest.sourceLocale

  const { default: initialTranslations } = await import(`../locales/${initialLocale}.json`)

  return (
    <html>
      <body>
        <VocoderProvider
          manifest={manifest}
          initialLocale={initialLocale}
          initialTranslations={initialTranslations}
          loadLocale={(locale) => import(`../locales/${locale}.json`).then(m => m.default)}
        >
          {children}
        </VocoderProvider>
      </body>
    </html>
  )
}
```

### Behavior in manifest props mode

- `manifest.sourceLocale` is used as the default locale when no cookie or `initialLocale` is set
- `initialTranslations` seeds the starting locale — no async load on first render
- `loadLocale` is called only when the user switches to a locale not yet loaded
- The hydration `<script>` tag is still emitted in SSR, so locale + translations are available on the client without a round-trip
- All other provider behavior (cookie persistence, `applyDir`, `setLocale`, `dir`, `useVocoder()`) works identically

---

## Non-React Frameworks

`VocoderCore` is framework-agnostic. Vue, Svelte, and Angular can use it directly without `@vocoder/react`.

### Vue 3

```ts
// src/i18n.ts — bootstrap (run before app.mount)
import { vocoder } from '@vocoder/core'
import manifest from '../locales/manifest.json'
import { loadLocale } from '../locales/loader.js'

vocoder.load(manifest, loadLocale)
export { vocoder }
```

```ts
// src/plugins/vocoder.ts
import { ref, reactive } from 'vue'
import type { App } from 'vue'
import { vocoder } from '../i18n'

export const VocoderPlugin = {
  install(app: App) {
    const locale = ref(vocoder.locale)
    const unsubscribe = vocoder.onChange(() => { locale.value = vocoder.locale })
    app.config.globalProperties.$t = vocoder.t.bind(vocoder)
    app.config.globalProperties.$setLocale = vocoder.activate.bind(vocoder)
    app.provide('vocoder', { locale, setLocale: vocoder.activate.bind(vocoder) })
    app.unmount = ((originalUnmount) => () => { unsubscribe(); originalUnmount() })(app.unmount)
  }
}
```

```ts
// src/main.ts
import { vocoder } from './i18n'
import { VocoderPlugin } from './plugins/vocoder'

vocoder.activate(manifest.sourceLocale).then(() => {
  const app = createApp(App)
  app.use(VocoderPlugin)
  app.mount('#app')
})
```

### Svelte

`VocoderCore` implements the Svelte store contract — subscribe with a function that receives an immediate snapshot, then updates on each locale change.

```ts
// src/lib/i18n.ts
import { vocoder } from '@vocoder/core'
import manifest from '../locales/manifest.json'
import { loadLocale } from '../locales/loader.js'

vocoder.load(manifest, loadLocale)
export { vocoder }
```

```svelte
<!-- src/App.svelte -->
<script>
  import { vocoder } from './lib/i18n'

  // $vocoder is a VocoderState snapshot: { locale, defaultLocale, locales, availableLocales }
  // Updates automatically when vocoder.activate() is called
</script>

{#if $vocoder.locale}
  <h1>{vocoder.t('Welcome')}</h1>
  <select bind:value={$vocoder.locale} on:change={e => vocoder.activate(e.target.value)}>
    {#each $vocoder.availableLocales as loc}
      <option value={loc}>{$vocoder.locales[loc]?.nativeName ?? loc}</option>
    {/each}
  </select>
{/if}
```

### Angular

```ts
// src/app/vocoder.service.ts
import { Injectable, OnDestroy } from '@angular/core'
import { BehaviorSubject } from 'rxjs'
import { vocoder } from '@vocoder/core'
import manifest from '../../locales/manifest.json'
import { loadLocale } from '../../locales/loader.js'

@Injectable({ providedIn: 'root' })
export class VocoderService implements OnDestroy {
  locale$ = new BehaviorSubject(vocoder.locale)
  private unsubscribe = vocoder.onChange(() => this.locale$.next(vocoder.locale))

  constructor() {
    vocoder.load(manifest, loadLocale)
    vocoder.activate(manifest.sourceLocale)
  }

  t = vocoder.t.bind(vocoder)
  setLocale = vocoder.activate.bind(vocoder)

  ngOnDestroy() { this.unsubscribe() }
}
```

---

## Monorepo / Custom `appDir`

For monorepos where the app package is not at the project root:

```ts
// MCP tool: pass appDir to vocoder_implement_i18n or vocoder_setup
{ appDir: '/absolute/path/to/apps/web' }
```

The plugin detects the monorepo root automatically in most cases, but `appDir` overrides when detection fails.

---

## Locale Detection Priority

`VocoderProvider` selects locale in this order:

1. **Cookie** (`vocoder_locale`) — user's previously saved preference
2. **Source locale** from `vocoder.config.ts`
3. **First available locale** in the manifest

The cookie is always preferred — this ensures the user's explicit language choice persists across page reloads and sessions.

---

## `isReady` — Avoiding Flash of Untranslated Content

```tsx
function Layout({ children }) {
  const { isReady } = useVocoder()

  if (!isReady) return <LoadingSpinner />

  return <div>{children}</div>
}
```

`isReady` is `true` when:
- Initial translations for the active locale are loaded
- Either hydration data exists (SSR) or the async init has completed (SPA)

In SSR setups with hydration, `isReady` is `true` immediately on first render — no spinner needed.
