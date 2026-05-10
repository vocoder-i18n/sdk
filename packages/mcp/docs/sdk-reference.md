# @vocoder/react SDK Reference

```ts
import { T, t, ordinal, useVocoder, VocoderProvider } from '@vocoder/react'
import { LocaleSelector } from '@vocoder/react/locale-selector'
import { getLocaleDir } from '@vocoder/react/server'
```

`LocaleSelector` is a separate entry point — intentional, to avoid bundling Radix UI into every project.

---

## `<T>` Component

Wrap any translatable JSX text. The build plugin extracts `<T>` at compile time and transforms natural syntax to explicit props. Use for all visible UI strings rendered in JSX.

**`message` prop takes precedence over `children`** — when both are present, `children` renders as fallback while translations load, but `message` is the lookup key.

### Props

| Prop | Type | Description |
|---|---|---|
| `children` | `ReactNode` | Source text / fallback content shown while translations load. Also used as lookup key when `message` is absent. |
| `message` | `string` | ICU message template. Used as translation lookup key. Required for interpolation, rich text via props, or raw ICU. |
| `id` | `string` | Stable key. Overrides hash-based lookup. Use when you rename source text and want to preserve existing translations. |
| `values` | `Record<string, any>` | Variable interpolation. **Only way to pass variables.** React elements in values are auto-promoted to component slots. |
| `value` | `string \| number \| Date` | Drives plural / select / ordinal / format mode. |
| `one` | `string` | CLDR plural: singular. `#` is replaced with the formatted number. |
| `two` | `string` | CLDR plural: dual (Arabic, Hebrew, etc.). |
| `few` | `string` | CLDR plural: a few (Polish, Russian, etc.). |
| `many` | `string` | CLDR plural: many (Polish, Russian, Arabic, etc.). |
| `other` | `string` | CLDR plural: default/fallback. **Required whenever any plural prop is present.** |
| `_0` / `_1` / `_2` | `string` | Exact numeric matches in plural mode (ICU `=0`, `=1`, `=2`). |
| `_word` | `string` | Select case. e.g. `_male`, `_female`, `_nonbinary`. Requires string `value` prop. |
| `ordinal` | `boolean` | Switches to ordinal mode (1st, 2nd, 3rd). Use with plural category props. |
| `gender` | `string` | Gendered ordinals for Arabic/Hebrew (`"masculine"` \| `"feminine"`). No-op for suffix-based locales. |
| `format` | `FormatMode` | Pure locale formatting — bypasses translation lookup, formats `value` via `Intl`. |
| `currency` | `string` | ISO 4217 code (e.g. `"USD"`). Required when `format="currency"`. |
| `dateStyle` | `string` | `"full" \| "long" \| "medium" \| "short"`. Used with `format="date"` or `"datetime"`. Default: `"medium"`. |
| `timeStyle` | `string` | `"full" \| "long" \| "medium" \| "short"`. Used with `format="time"` or `"datetime"`. Default: `"short"`. |
| `context` | `string` | Disambiguation when the same source text has different meanings in different UI contexts. |
| `formality` | `string` | `"formal" \| "informal" \| "auto"`. Translation formality. |
| `components` | `ComponentSlot[] \| Record<number, ComponentSlot>` | Rich-text inline elements. Each slot maps to a numeric `<N>` placeholder. A slot is a React element (children injected via `cloneElement`) or a render function `(children: ReactNode) => ReactNode`. Plugin injects automatically for natural JSX syntax. |

### Preferred patterns

```tsx
// Static text (preferred: children form)
<T>Hello, world!</T>

// Also valid: message prop form
<T message="Hello, world!" />

// Interpolation (preferred: natural syntax — plugin handles it)
<T>Hello {name}!</T>

// Also valid: explicit message + values
<T message="Hello {name}!" values={{ name }} />

// Plural (preferred: shorthand props)
<T value={count} one="# item" other="# items" />

// Plural with exact overrides
<T value={count} _0="No items" _1="Exactly one item" one="# items" other="# items" />

// Plural with extra interpolation variables
<T value={count} values={{ count, folder }} _0="No messages in {folder}" one="# message in {folder}" other="# messages in {folder}" />

// Select (preferred: _word shorthand props)
<T value={gender} _male="He replied" _female="She replied" other="They replied" />

// Ordinal
<T value={rank} ordinal one="#st" two="#nd" few="#rd" other="#th" />
<T value={rank} ordinal />  // pipeline generates locale-correct ordinal branches automatically

// Gender-aware ordinal (Arabic/Hebrew)
<T value={rank} ordinal gender={gender} />

// Rich text (preferred: natural JSX — plugin injects components automatically)
<T>Read <a href="/docs">the docs</a> for help.</T>

// Rich text (explicit array — use when natural syntax isn't possible)
<T message="Read <0>the docs</0> for help." components={[<a href="/docs" />]} />

// Rich text: multiple slots
<T
  message="Read our <0>Privacy Policy</0> and <1>Terms of Service</1>"
  components={[<a href="/privacy" />, <a href="/terms" />]}
/>

// Rich text: function slot (render prop — when you need wrapper logic)
<T
  message="Terms: <0>I agree</0> to the policy"
  components={[(children) => (
    <label><input type="checkbox" /><span>{children}</span></label>
  )]}
/>

// Rich text: sparse object form (skip indices)
<T
  message="<0>Bold</0> and <2>italic</2>"
  components={{ 0: <strong />, 2: <em /> }}
/>

// Rich text: self-closing slot (icon, badge)
<T message="Upload complete <0/>" components={[<span className="icon-check" />]} />

// React element in values (auto-promoted to slot)
<T message="Rating: {star} Great product!" values={{ star: <span>★</span> }} />

// Currency
<T value={price} format="currency" currency="USD" />

// Currency from locale config (recommended — no hardcoding)
const { locale, locales } = useVocoder()
const currency = locales?.[locale]?.currencyCode ?? 'USD'
<T value={price} format="currency" currency={currency} />

// Number formatting
<T value={price} format="number" />
<T value={price} format="integer" />
<T value={ratio} format="percent" />
<T value={bigNum} format="compact" />

// Date formatting
<T value={new Date()} format="date" dateStyle="long" />
<T value={new Date()} format="time" timeStyle="short" />
<T value={new Date()} format="datetime" dateStyle="medium" timeStyle="short" />

// Context disambiguation
<T context="nav-tooltip">Home</T>
<T context="hero-section">Home</T>

// Stable ID (survives source text rename)
<T id="submit-btn">Submit</T>

// Formality
<T formality="formal">Please enter your name.</T>
```

### Raw ICU via message prop (power user)

For complex constructs that don't fit the shorthand props:

```tsx
// Raw ICU select
<T
  message="{status, select, pending {Order is pending} shipped {Shipped} delivered {Delivered} other {Unknown}}"
  values={{ status }}
/>

// Raw ICU with number skeleton
<T message="Total: {amount, number, ::currency/USD}" values={{ amount }} />

// Nested plural + select
<T
  message="{n, plural, one {{g, select, male {he has} female {she has} other {they have}} # item} other {{g, select, male {his} female {her} other {their}} # files}}"
  values={{ n: count, g: gender }}
/>

// Ordinal embedded in a sentence
<T
  message="Your {year, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} anniversary!"
  values={{ year: rank }}
/>

// Plural with offset
<T
  message="{count, plural, offset:1 =0 {Just you} =1 {You and one other} other {You and # others}}"
  values={{ count }}
/>
```

---

## `t()` Function

```ts
t(text: string, values?: Record<string, any>, options?: TOptions): string
```

Returns a translated string. Use for non-JSX contexts: `placeholder`, `aria-label`, `title`, `document.title`, toast messages, validation errors, event handlers.

**Does not support rich text** — components slots are only available in `<T>`.

### When to use module-level `t()` vs `useVocoder().t`

| Situation | Use |
|---|---|
| Inside a React component, string must update when locale changes | `useVocoder().t` — reactive, tied to React state |
| Event handler, utility function, outside React render | `t()` — reads current global locale at call time |
| `placeholder`, `aria-label` in a component render | `useVocoder().t` — re-renders on locale change |
| Toast/notification triggered by user action | Either — locale is current at the moment of call |
| Server-side or outside React tree | `t()` — no hook available |

See `vocoder://docs/t-function` for full reactivity details.

### Options

| Option | Type | Description |
|---|---|---|
| `context` | `string` | Disambiguation — must match the `context` used in `<T context="...">` |
| `formality` | `string` | `"formal" \| "informal" \| "auto"` |
| `id` | `string` | Bypass hash computation — look up by explicit key |

### Examples

```ts
t('Save changes')
t('Hello, {name}!', { name: user.name })
t('Delete {count} files?', { count })
t('Save', {}, { context: 'button' })
t('{count, plural, one {# item} other {# items}}', { count })
t('fallback text', {}, { id: 'explicit-catalog-key' })

// In a component — use hook form for reactivity
const { t } = useVocoder()
const placeholder = t('Enter your email')

// In a utility or callback — use module-level
import { t } from '@vocoder/react'
function formatError(code: string) {
  return t('Error: {code}', { code })
}
```

---

## `ordinal()` Function

```ts
ordinal(value: number, gender?: string): string
```

Format a number as locale-aware ordinal outside React. Uses global locale state. Falls back to `String(value)` when ordinal data unavailable.

```ts
import { ordinal } from '@vocoder/react'
ordinal(1) // "1st" in en, "1.º" in es, "1." in de, "الأول" in ar (with gender)
```

For reactive ordinal inside components, use `useVocoder().ordinal`.

---

## `useVocoder()` Hook

Must be called inside a component tree wrapped by `VocoderProvider`. Throws if called outside.

### Returns

| Property | Type | Description |
|---|---|---|
| `locale` | `string` | Active BCP 47 locale code (e.g. `"en"`, `"ar"`, `"pt-BR"`) |
| `setLocale` | `(locale: string) => Promise<void>` | Switch locale. Loads translations lazily, persists to cookie. |
| `availableLocales` | `string[]` | All configured locales |
| `isReady` | `boolean` | `true` when initial translations are loaded. Use to avoid showing untranslated flash. |
| `dir` | `"ltr" \| "rtl"` | Text direction for the current locale |
| `locales` | `LocalesMap \| undefined` | Locale metadata: `nativeName`, `dir`, `currencyCode`, `ordinalForms` per locale code |
| `t` | `(text, values?, options?) => string` | Reactive translate — re-runs on locale change. Use inside components. |
| `ordinal` | `(value: number, gender?: string) => string` | Reactive ordinal — re-runs on locale change. |
| `hasTranslation` | `(key: string) => boolean` | Check if a translation exists by hash key. Use `generateMessageHash(text)` to get a key from source text. |
| `getDisplayName` | `(targetLocale: string, viewingLocale?: string) => string` | Human-readable locale name via `Intl.DisplayNames`. Defaults viewing locale to active locale. |

### Common usage patterns

```tsx
// Locale switcher
const { locale, setLocale, availableLocales, getDisplayName, locales } = useVocoder()

// Button switcher
{availableLocales.map(loc => (
  <button key={loc} onClick={() => setLocale(loc)}>
    {locales?.[loc]?.nativeName ?? loc}
  </button>
))}

// Display current locale name
const { locale, getDisplayName } = useVocoder()
const displayName = getDisplayName(locale) // "English", "Español", "العربية"

// Currency from locale config
const { locale, locales } = useVocoder()
const currency = locales?.[locale]?.currencyCode ?? 'USD'

// RTL-aware layout
const { dir } = useVocoder()
<div style={{ direction: dir }}>...</div>

// Conditional on ready state
const { isReady } = useVocoder()
if (!isReady) return <Skeleton />

// Reactive placeholder
const { t } = useVocoder()
<input placeholder={t('Search...')} />

// Reactive ordinal
const { ordinal } = useVocoder()
<span>{ordinal(rank)}</span>  // "1st" → updates when locale changes
```

---

## `VocoderProvider`

Required context provider. Place at the root of your app (client-side). Manages locale state, loads translations, persists locale preference to cookie (`vocoder_locale`).

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `ReactNode` | — | Required |
| `initialLocale` | `string` | — | SSR-detected locale. Pass the raw `vocoder_locale` cookie value from the server. The provider normalizes it against available locales automatically. Omit for client-only apps. |
| `preview` | `boolean` | — | Whether this user has preview mode enabled. Resolve from the `vocoder_preview` cookie server-side and pass the boolean. Only relevant when `preview: true` is set in the build plugin config. |
| `applyDir` | `boolean` | `true` | Auto-sets `dir` and `lang` on `document.documentElement` when locale changes. Set `false` only if you manage direction yourself. |

### SPA (Vite, CRA)

```tsx
// src/main.tsx
import { VocoderProvider } from '@vocoder/react'

root.render(
  <VocoderProvider>
    <App />
  </VocoderProvider>
)
```

### Next.js App Router

`VocoderProvider` is a Client Component. Place it in `layout.tsx` — the outer server component reads the cookies and passes them as props:

```tsx
// app/layout.tsx (Server Component)
import { cookies } from 'next/headers'
import { VocoderProvider } from '@vocoder/react'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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
```

### Next.js Pages Router

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
  const initialLocale = cookie.match(/vocoder_locale=([^;]+)/)?.[1]
  const preview = /vocoder_preview=true/.test(cookie)
  return { pageProps: { initialLocale, preview } }
}
```

---

## `getLocaleDir()`

Import from `@vocoder/react/server`. Returns `"ltr"` or `"rtl"` for a locale using the Vocoder manifest locale metadata. Use in Next.js App Router layout to set `<html dir>` on the server.

```tsx
// app/layout.tsx
import { config } from 'virtual:vocoder/manifest'
import { cookies } from 'next/headers'
import { getLocaleDir } from '@vocoder/react/server'

export default async function RootLayout({ children }) {
  const locale = (await cookies()).get('vocoder_locale')?.value ?? config.sourceLocale
  const dir = getLocaleDir(locale, config.locales)
  return <html lang={locale} dir={dir}>{children}</html>
}
```

---

## `LocaleSelector`

Import from `@vocoder/react/locale-selector` (separate entry point — avoids bundling Radix UI unless used).

Fixed-position floating button with Vocoder branding. Opens a dropdown of available locales. Only renders when Vocoder is enabled (hidden in preview-disabled mode).

```tsx
import { LocaleSelector } from '@vocoder/react/locale-selector'

// Default — bottom-right corner
<LocaleSelector />

// Other positions
<LocaleSelector position="top-left" />
<LocaleSelector position="bottom-left" />

// Custom colors
<LocaleSelector background="#ffffff" color="#000000" />

// Custom sort order
<LocaleSelector sortBy="native" />   // by native name (default) — consistent across all locales
<LocaleSelector sortBy="source" />   // by English name — consistent across all locales
<LocaleSelector sortBy="translated" /> // by name in current viewing locale — changes per locale

// Custom locale metadata (falls back to context locales if omitted)
<LocaleSelector locales={{ en: { nativeName: 'English' }, es: { nativeName: 'Español' } }} />
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `position` | `string` | `"bottom-right"` | `"top-left"`, `"top-right"`, `"bottom-left"`, `"bottom-right"` (or `"tl"`, `"tr"`, `"bl"`, `"br"`) |
| `background` | `string` | Brand adaptive | Button/dropdown background color. Defaults to `#1a1a1a` (light) / `#EFEAE3` (dark). |
| `color` | `string` | Brand adaptive | Button/dropdown text color. Defaults to `#EFEAE3` (light) / `#1a1a1a` (dark). |
| `className` | `string` | `""` | Additional CSS class on the wrapper div |
| `iconSize` | `number` | `20` | Logo icon size in pixels |
| `locales` | `LocalesMap` | from context | Locale metadata. Auto-read from context if omitted. |
| `sortBy` | `string` | `"native"` | Sort order: `"native"`, `"source"`, `"translated"` |

### Built-in vs custom — when to use each

**Use `LocaleSelector` when:**
- You want zero-config setup — drop it anywhere inside `VocoderProvider` and it works
- The floating fixed-position widget fits your UI (sidebars, admin panels, internal tools, prototypes)
- You don't have an existing design system the switcher needs to match

**Build a custom switcher when:**
- You need it embedded in a nav bar, header, footer, or settings page rather than floating
- Your design system has its own dropdown/select component you want to use
- You want to avoid the Radix UI dependency (~40KB gzip) that `LocaleSelector` bundles
- You need behavior not exposed by `LocaleSelector` props (animated transitions, search, grouped locales)

The custom path is three lines with `useVocoder()` — not significantly more work than dropping in `<LocaleSelector />`.

### Custom locale switcher

Build your own using `useVocoder()`:

```tsx
const { locale, setLocale, availableLocales, getDisplayName, locales } = useVocoder()

// Button switcher
<div className="flex gap-2">
  {availableLocales.map(loc => (
    <button
      key={loc}
      onClick={() => setLocale(loc)}
      className={locale === loc ? 'font-bold' : ''}
    >
      {locales?.[loc]?.nativeName ?? loc}
    </button>
  ))}
</div>

// Select/dropdown
<select value={locale} onChange={e => setLocale(e.target.value)}>
  {availableLocales.map(loc => (
    <option key={loc} value={loc}>
      {getDisplayName(loc)} ({locales?.[loc]?.nativeName ?? loc})
    </option>
  ))}
</select>

// List with active state
{availableLocales.map(loc => (
  <button key={loc} onClick={() => setLocale(loc)}
    className={`w-full text-left px-4 py-2 rounded ${locale === loc ? 'bg-primary text-white' : 'hover:bg-secondary'}`}>
    <div className="flex justify-between">
      <span>{locales?.[loc]?.nativeName ?? loc}</span>
      <span className="opacity-70">{getDisplayName(loc)}</span>
    </div>
  </button>
))}
```

---

## Build Plugin

See `vocoder://docs/plugin-reference` for full details.

### Next.js

```ts
// next.config.ts
import { withVocoder } from '@vocoder/plugin/next'
export default withVocoder({ /* next.js config */ })
```

### Vite

```ts
// vite.config.ts
import vocoder from '@vocoder/plugin/vite'
export default defineConfig({ plugins: [vocoder()] })
```

### Other bundlers

```ts
// webpack.config.js
const { VocoderPlugin } = require('@vocoder/plugin/webpack')
plugins: [new VocoderPlugin()]

// rollup.config.js
import vocoder from '@vocoder/plugin/rollup'
plugins: [vocoder()]

// esbuild
import { vocoderPlugin } from '@vocoder/plugin/esbuild'
plugins: [vocoderPlugin()]
```

---

## Config File

```ts
// vocoder.config.ts
import { defineConfig } from '@vocoder/config'

export default defineConfig({
  localesPath: 'src/locales',    // where locale JSON files live
  include: ['src/**/*.{ts,tsx}'], // files to scan (defaults to all source)
  exclude: ['**/*.test.*'],       // files to skip
  targetBranches: ['main'],       // branches that trigger translation
  formality: 'auto',              // default formality for DeepL
  industry: 'saas',               // context hint for translation quality (saas, ecommerce, travel, legal, government, nonprofit, other)
})
```
