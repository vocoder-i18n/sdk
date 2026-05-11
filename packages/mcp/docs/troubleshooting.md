# Troubleshooting Common Vocoder Issues

---

## Strings not being translated (showing source text)

**Cause 1: Build plugin not configured**

Check `next.config.ts` / `vite.config.ts` for the Vocoder plugin.

```ts
// next.config.ts — must use withVocoder
import { withVocoder } from '@vocoder/plugin/next'
export default withVocoder({})

// vite.config.ts — must include vocoder plugin
import vocoder from '@vocoder/plugin/vite'
export default defineConfig({ plugins: [react(), vocoder()] })
```

**Cause 2: No API key / translations not submitted**

```
[vocoder] Missing translation for locale "es": "Hello, world!"
```

This console warning appears in development when a translation is missing. Fix:
1. Run `npx @vocoder/cli init` to set up the project and get an API key
2. Add `VOCODER_API_KEY` to `.env`
3. Call the `vocoder_sync` MCP tool, or push to a target branch to trigger the GitHub Actions workflow

**Cause 3: `VocoderProvider` not wrapping the component**

`<T>` and `useVocoder()` require `VocoderProvider` as an ancestor. Check the component tree.

```tsx
// ❌ Missing provider
root.render(<App />)

// ✅ Wrapped
root.render(<VocoderProvider><App /></VocoderProvider>)
```

**Cause 4: Using source locale**

If `locale === sourceLocale`, translations are not applied — Vocoder returns the source text as-is. Switch to a target locale to see translations.

---

## `useVocoder` throws "must be used inside VocoderProvider"

The component calling `useVocoder()` is not inside a `VocoderProvider`. Common in:

- Components rendered in a portal (tooltip, modal, drawer) that is mounted outside the Provider's DOM subtree
- Test utilities that don't wrap with Provider
- Server components trying to call a client hook

Fix: ensure `VocoderProvider` wraps the full component tree, including portals.

---

## Strings not being extracted

**Cause 1: Bail condition in `<T>` children**

The extractor bails silently on patterns it can't handle:

```tsx
// ❌ Not extracted — conditional inside T
<T>{isNew ? 'New' : 'Old'} item</T>

// ✅ Fix — move conditional outside
{isNew ? <T>New item</T> : <T>Old item</T>}
```

See `vocoder://docs/extractor` for all bail cases.

**Cause 2: `t()` function is renamed**

The extractor finds `t()` by literal function name. If you import it as something else, extraction breaks:

```ts
// ❌ Not extracted
import { t as translate } from '@vocoder/react'
translate('Hello')

// ✅ Always use the name `t`
import { t } from '@vocoder/react'
t('Hello')
```

**Cause 3: File not in scan scope**

Check `include`/`exclude` in `vocoder.config.ts`. The file may be outside the scan paths, or matching an exclude pattern.

**Cause 4: String is in a test file**

Extractor skips test files by default. This is intentional — don't wrap test strings in `<T>`.

---

## LocaleSelector not showing

`LocaleSelector` returns `null` when Vocoder is not enabled. In production, it's always enabled. In development, it can be toggled via:

```
?vocoder=true   # force enable
?vocoder=false  # force disable
```

The state is stored in a cookie (`vocoder_preview`). If you visited with `?vocoder=false` previously, the component stays hidden. Reset with `?vocoder=true` or clear the cookie.

Also check: `LocaleSelector` must be inside `VocoderProvider`.

---

## Locale not persisting across page reloads

`VocoderProvider` stores locale in `vocoder_locale` cookie (1-year expiry, `path: "/"`, `sameSite: "Lax"`).

If locale resets on reload:
- Check that cookies are not blocked by the browser or stripped by a CDN/proxy
- Check `path` — if your app is not at `/`, the cookie may not be read for sub-paths
- For SSR, verify `initialLocale` is passed to `VocoderProvider` from the server (parsed from `vocoder_locale` cookie)

---

## Hydration mismatch (SSR)

**Symptom:** React hydration errors, content flicker, wrong locale on first render.

**Cause:** Server rendered with a different locale than the client hydrated with.

**Fix:** Pass the locale and preview flag from the server to `VocoderProvider`:

```tsx
// Next.js App Router (app/layout.tsx)
import { cookies } from 'next/headers'
import { VocoderProvider } from '@vocoder/react'

export default async function RootLayout({ children }) {
  const cookieStore = await cookies()
  const initialLocale = cookieStore.get('vocoder_locale')?.value
  const preview = cookieStore.get('vocoder_preview')?.value === 'true'
  return (
    <html>
      <body>
        <VocoderProvider initialLocale={initialLocale} preview={preview}>
          {children}
        </VocoderProvider>
      </body>
    </html>
  )
}

// Next.js Pages Router (_app.tsx)
<VocoderProvider initialLocale={pageProps.initialLocale} preview={pageProps.preview}>
```

`VocoderProvider` injects a hydration snapshot into the HTML so the client reads the same locale + translations as the server rendered. Without `initialLocale`, the server defaults to source locale and the client reads the cookie — mismatch.

---

## RTL layout not applying

**Check 1: `applyDir` is not false**

```tsx
// ❌ Opt-out — dir/lang never set on <html>
<VocoderProvider applyDir={false}>

// ✅ Default — applyDir=true, dir set automatically
<VocoderProvider>
```

**Check 2: Locale is actually RTL**

```tsx
const { locale, dir } = useVocoder()
console.log(locale, dir) // "ar", "rtl"
```

RTL locales: `ar`, `he`, `fa`, `ur`, `ps`, `sd`, `ug`, `yi`, `dv`, `ku`.

**Check 3: SSR `<html dir>` not set**

For Next.js App Router, `applyDir` runs client-side after hydration. Use `getLocaleDir` in the layout to set `dir` server-side:

```tsx
// app/layout.tsx
const dir = getLocaleDir(locale, config.locales)
return <html lang={locale} dir={dir}>
```

---

## Build produces no translations / empty bundles

**Cause 1: No `VOCODER_API_KEY` in build environment**

Set `VOCODER_API_KEY` in your CI/CD environment variables (not just `.env` which may not be read by CI).

**Cause 2: Strings unchanged, translation skipped**

If strings haven't changed since the last translation, the API skips re-translation. This is correct behavior. Force a re-translation by calling `vocoder_sync` with `force: true` if translations are actually missing.

**Cause 3: Target branch not configured**

Only branches in `targetBranches` (from `vocoder.config.ts`) trigger translation. Verify the branch name matches exactly.

---

## Translations load after first render (flash)

**In SPA:** This is expected when translations aren't bundled. Call `vocoder_sync` or push to trigger the GitHub Actions workflow before building to embed translations at build time.

**In SSR:** Pass `initialLocale` and `preview` to `VocoderProvider` from the server. The hydration mechanism provides instant translations from a server-side snapshot.

**Background CDN refresh:** If the build has no translations (API unreachable during build), `VocoderProvider` fetches from the CDN after mount. This may cause a brief flash. The CDN fetch succeeds in milliseconds when translations exist.

---

## `message` prop content not translating

Verify the exact message string was synced. The lookup key is the hash of the `message` string. If the message changed after the last sync, the new string won't have a translation yet.

Call the `vocoder_sync` MCP tool or push to a target branch to trigger translation after message changes.

If using `id` for stable keys:
```tsx
<T id="submit-btn">Submit</T>
// Lookup key is "submit-btn" — translations survive message text changes
```

---

## TypeScript errors on `<T>` props

**`_word` props** use the index signature `[key: \`_${string}\`]: string | undefined`. TypeScript is fine with this — you can pass any `_prefixed` prop.

**`components` type** is `ComponentSlot[] | Record<number, ComponentSlot>`. A `ComponentSlot` is `React.ReactElement | ((children: React.ReactNode) => React.ReactNode)`.

---

## Checking what the extractor sees

Use the MCP `vocoder_sync` tool to see which strings were extracted and submitted.

Or use `vocoder_status` to check the current project config and verify the API key is working.
