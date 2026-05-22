# @vocoder/react

React components and hooks for the Vocoder i18n platform. Provides `<T>` for translating JSX, `t()` for plain strings, and a provider that manages locale state with SSR support.

## Installation

```bash
npm install @vocoder/react
```

Requires React 18+. Pair with [`@vocoder/cli`](../cli) to extract and translate strings via your GitHub Actions workflow.

---

## Setup

### With @vocoder/plugin (recommended)

Install `@vocoder/plugin` and wire it up to your bundler. The provider needs no props — the plugin injects the manifest and handles locale loading automatically:

```tsx
// main.tsx (Vite SPA)
import ReactDOM from 'react-dom/client';
import { VocoderProvider } from '@vocoder/react';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <VocoderProvider>
    <App />
  </VocoderProvider>,
);
```

```tsx
// app/layout.tsx (Next.js App Router with @vocoder/plugin)
import { cookies } from 'next/headers';
import { VocoderProvider } from '@vocoder/react';
import { getLocaleDir, getConfig, getLocales } from '@vocoder/react/server';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const initialLocale = cookieStore.get('vocoder_locale')?.value;
  const config = getConfig();
  const locale = initialLocale ?? config.sourceLocale ?? 'en';
  const dir = getLocaleDir(locale, getLocales());
  return (
    <html lang={locale} dir={dir}>
      <body>
        <VocoderProvider initialLocale={initialLocale}>
          {children}
        </VocoderProvider>
      </body>
    </html>
  );
}
```

### Without @vocoder/plugin (manifest mode)

Pass the manifest and locale loading logic directly as props. Use this in frameworks or environments where a build plugin is not practical:

```tsx
// main.tsx (Vite SPA — manual mode)
import ReactDOM from 'react-dom/client';
import { VocoderProvider } from '@vocoder/react';
import manifest from './locales/manifest.json';
import en from './locales/en.json';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <VocoderProvider
    manifest={manifest}
    initialLocale="en"
    initialTranslations={en}
    loadLocale={(locale) => import(`./locales/${locale}.json`).then((m) => m.default)}
  >
    <App />
  </VocoderProvider>,
);
```

```tsx
// app/layout.tsx (Next.js App Router — manual mode)
import { cookies } from 'next/headers';
import { VocoderProvider } from '@vocoder/react';
import { getLocaleDir } from '@vocoder/react/server';
import manifest from '@/locales/manifest.json';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = cookieStore.get('vocoder_locale')?.value ?? manifest.sourceLocale;
  const translations = (await import(`@/locales/${locale}.json`)).default;
  const dir = getLocaleDir(locale, manifest.locales);
  return (
    <html lang={locale} dir={dir}>
      <body>
        <VocoderProvider
          manifest={manifest}
          initialLocale={locale}
          initialTranslations={translations}
          loadLocale={(l) => import(`@/locales/${l}.json`).then((m) => m.default)}
        >
          {children}
        </VocoderProvider>
      </body>
    </html>
  );
}
```

Locale files are updated by the GitHub Action on each push — no rebuild required to pick up new translations.

### VocoderProvider props

| Prop | Type | Default | Description |
|---|---|---|---|
| `children` | `ReactNode` | required | Your app tree |
| `manifest` | `LocaleManifest` | — | Locale manifest from `locales/manifest.json`. When provided, the provider reads config from the manifest instead of build-time globals. |
| `initialLocale` | `string` | — | Locale to render on first paint. Required when using `manifest`. |
| `initialTranslations` | `Record<string, string>` | — | Pre-loaded translations for `initialLocale`. Required when using `manifest` to avoid a flash on first paint. |
| `loadLocale` | `(locale: string) => Promise<Record<string, string>>` | — | Dynamic import function for switching locales. Required when using `manifest`. |
| `applyDir` | `boolean` | `true` | Automatically set `dir` and `lang` on `document.documentElement` when locale changes. Enables RTL via CSS (`[dir="rtl"]`, Tailwind `rtl:` variants). |

### Locale persistence

The active locale is stored in `localStorage` and a `vocoder_locale` cookie. On the server, the cookie is read from the `cookies` prop (no-manifest mode) or the `initialLocale` prop (manifest mode).

---

## The `<T>` Component

`<T>` handles all translation modes: plain text, interpolation, plurals, selects, ordinals, rich text, and locale-aware formatting.

### Natural JSX syntax

Write your content directly as JSX children. `@vocoder/plugin` injects the `message` and `values` props automatically at build time — no manual string management required:

```tsx
import { T } from '@vocoder/react';

// Static text
<T>Hello, world!</T>

// Variables — the build plugin injects: message="Hello {name}!" values={{ name }}
<T>Hello {name}!</T>

// JSX children with components — plugin injects message and components prop
<T>Read <a href="/docs" className="underline">the docs</a> for help.</T>
```

### Explicit message prop

Use `message` directly when you need full control over the ICU string:

```tsx
<T message="Hello, {name}!" values={{ name: user.name }} />
<T message="{count, plural, one {# item} other {# items}}" values={{ count }} />
```

---

### Pluralization

Use CLDR plural category props alongside `value`:

```tsx
// Cardinal plural
<T value={count} one="# item" other="# items" />

// With zero exact match
<T value={count} _0="No items" one="# item" other="# items" />

// All CLDR categories (for Polish, Arabic, etc.)
<T value={count} one="# przedmiot" few="# przedmioty" many="# przedmiotów" other="# przedmiotu" />
```

**Exact numeric matches** use underscore-prefixed numbers (`_0`, `_1`, `_2`). They map to ICU `=0`, `=1`, `=2`.

**CLDR categories**: `zero`, `one`, `two`, `few`, `many`, `other`. Which categories are active depends on the locale — Vocoder handles this automatically.

### Select (gender, status, etc.)

Use underscore-prefixed word props alongside `value`:

```tsx
// Gender-based select
<T value={gender} _male="He replied" _female="She replied" other="They replied" />

// Status select
<T value={status} _pending="Awaiting review" _approved="Approved" other="Unknown" />
```

### Ordinals

Rank numbers in the active locale's ordinal style (1st, 2nd, 3rd; 1.º, 2.º; etc.):

```tsx
<T value={rank} ordinal />
// en → "1st", "2nd", "3rd"
// es → "1.º", "2.º"
// fr → "1er", "2e"

// Word-based ordinals (Arabic, Hebrew) — pass gender for correct inflection
<T value={rank} ordinal gender="feminine" />
```

Ordinal forms are defined per locale in the manifest config generated by the CLI.

### Rich text

Wrap inline elements with numeric component placeholders. The build plugin injects these automatically when you use natural JSX syntax.

**Array form** (sequential index, most common):

```tsx
// Single link
<T
  message="Click <0>here</0> to learn more"
  components={[<a href="/help" />]}
/>

// Multiple components — index matches order in the array
<T
  message="Read our <0>Privacy Policy</0> and <1>Terms of Service</1>"
  components={[
    <a href="/privacy" />,
    <a href="/terms" />,
  ]}
/>
```

**Object form** (sparse indices, useful when skipping slots):

```tsx
<T
  message="<0>Bold</0> and <2>italic</2> text"
  components={{
    0: <strong />,
    2: <em />,
  }}
/>
```

**Function slots** — receive translated inner content as `ReactNode`, return `ReactNode`. Use when the wrapper element needs dynamic props derived at render time:

```tsx
<T
  message="Terms: <0>I agree</0> to the policy"
  components={[(children) => (
    <label className="flex items-center gap-1">
      <input type="checkbox" />
      <span>{children}</span>
    </label>
  )]}
/>
```

**Self-closing components** (icons, images):

```tsx
<T
  message="Upload complete <0/>"
  components={[<CheckIcon className="inline w-4 h-4" />]}
/>
```

**Nested components**:

```tsx
<T
  message="See <0>our <1>docs</1></0> for details"
  components={[<a href="/docs" />, <strong />]}
/>
```

**React elements in `values`** are auto-promoted to self-closing component slots — no `components` prop needed:

```tsx
<T
  message="Rating: {star} — highly recommended"
  values={{ star: <StarIcon className="inline w-4 h-4 text-yellow-500" /> }}
/>
```

---

### Locale-aware formatting

Use the `format` prop to format numbers, currencies, and dates without a translation lookup. The value is formatted using `Intl` APIs for the active locale.

```tsx
// Numbers
<T value={1234.56} format="number" />      // "1,234.56" (en), "1.234,56" (de)
<T value={1234.56} format="integer" />     // "1,235"
<T value={0.742} format="percent" />       // "74.2%"
<T value={1234567} format="compact" />     // "1.2M"

// Currency — requires the currency prop (ISO 4217)
<T value={29.99} format="currency" currency="USD" />   // "$29.99"
<T value={29.99} format="currency" currency="EUR" />   // "€29,99" (fr)

// Dates
<T value={new Date()} format="date" dateStyle="long" />      // "May 6, 2025"
<T value={new Date()} format="time" timeStyle="short" />     // "3:45 PM"
<T value={new Date()} format="datetime" dateStyle="medium" timeStyle="short" />
```

Format modes:

| `format` | Description | Relevant props |
|---|---|---|
| `number` | Locale decimal number | — |
| `integer` | Rounded integer | — |
| `percent` | Percentage | — |
| `compact` | Compact notation (1.2M, 4.5K) | — |
| `currency` | Currency symbol + amount | `currency` (required) |
| `date` | Date only | `dateStyle` (`full` / `long` / `medium` / `short`, default `medium`) |
| `time` | Time only | `timeStyle` (`full` / `long` / `medium` / `short`, default `short`) |
| `datetime` | Date and time | `dateStyle`, `timeStyle` |

---

### Context and formality

Use `context` to disambiguate identical source strings with different meanings:

```tsx
<T context="button">Save</T>
<T context="noun">Save</T>
// Same source text, different translations, different catalog keys
```

Use `formality` to hint at the required register for the translator:

```tsx
<T formality="formal">Please submit your application.</T>
<T formality="informal">Go ahead and apply!</T>
```

Use `id` to supply a stable catalog key that survives source text edits:

```tsx
<T id="onboarding.welcome">Welcome to the app!</T>
```

---

### Props reference

| Prop | Type | Description |
|---|---|---|
| `children` | `ReactNode` | Source text / fallback content. Also the translation input when no `message` prop is present. |
| `message` | `string` | ICU message string. Takes precedence over `children` for lookup. |
| `values` | `Record<string, any>` | Runtime values for `{name}` interpolation. The only supported way to pass variables. |
| `id` | `string` | Stable catalog key — bypasses content hashing. |
| `context` | `string` | Disambiguation string. Same source text + different context = different catalog entry. |
| `formality` | `'formal' \| 'informal' \| 'auto'` | Translation register hint. |
| `components` | `ComponentSlot[] \| Record<number, ComponentSlot>` | Component slots for `<0>`, `<1>` rich-text placeholders. Each slot is a `ReactElement` or `(children: ReactNode) => ReactNode`. |
| `value` | `string \| number \| Date` | The value driving plural/select/ordinal selection, or the input to `format`. |
| `one` `two` `few` `many` `other` | `string` | CLDR plural branches. Activates plural mode when present alongside `value`. Use `#` as the number placeholder. |
| `_0` `_1` `_2` | `string` | Exact numeric matches in plural mode (ICU `=0`, `=1`, `=2`). |
| `_male` `_female` `_nonbinary` … | `string` | Select cases. Activates select mode when present without CLDR props. Key after `_` becomes the ICU case. |
| `ordinal` | `boolean` | Switches to ordinal mode. Formats `value` as a locale-aware ordinal (1st, 2nd, …). |
| `gender` | `string` | Grammatical gender for word-based ordinal locales (Arabic, Hebrew). |
| `format` | `FormatMode` | Pure Intl formatting — bypasses translation lookup. |
| `currency` | `string` | ISO 4217 code required when `format="currency"`. |
| `dateStyle` | `'full' \| 'long' \| 'medium' \| 'short'` | Date display style. Default `'medium'`. |
| `timeStyle` | `'full' \| 'long' \| 'medium' \| 'short'` | Time display style. Default `'short'`. |

---

## The `t()` Function

Use `t()` for translations outside JSX — toast messages, `aria-label`, `document.title`, validation errors, etc.

```tsx
import { t } from '@vocoder/react';

// Simple
const label = t('Hello, world!');

// With variables
const greeting = t('Hello, {name}!', { name: user.name });

// ICU plural
const summary = t('{count, plural, =0 {No items} one {# item} other {# items}}', { count });

// Context disambiguation
const action = t('Save', {}, { context: 'button' });

// Explicit catalog key
const banner = t('', {}, { id: 'welcome_banner' });
```

`t()` uses global state synced by `VocoderProvider`. Call it only after the provider has mounted. Rich text with component slots is not supported — use `<T>` for that.

### Options

| Option | Type | Description |
|---|---|---|
| `context` | `string` | Must match the `context` on the corresponding `<T>` |
| `formality` | `'formal' \| 'informal' \| 'auto'` | Translation register hint |
| `id` | `string` | Stable lookup key — skips hashing the source text |

---

## The `ordinal()` Function

Format a number as a locale-aware ordinal outside of React components:

```tsx
import { ordinal } from '@vocoder/react';

ordinal(1)   // "1st" (en), "1.º" (es), "1er" (fr)
ordinal(2)   // "2nd" (en), "2.º" (es), "2e" (fr)
ordinal(21)  // "21st" (en), "21.º" (es)

// Word-based locales (Arabic, Hebrew)
ordinal(1, 'feminine')
ordinal(1, 'masculine')
```

Reads ordinal forms from the manifest config for the current locale. Falls back to `String(value)` when forms are unavailable.

---

## The `useVocoder()` Hook

Access locale state and translation utilities in components. Reactive — re-renders when the locale changes.

```tsx
import { useVocoder } from '@vocoder/react';

function LocaleSwitcher() {
  const {
    locale,           // Current locale code: 'en', 'es', 'fr', …
    setLocale,        // (locale: string) => Promise<void>
    availableLocales, // string[] — all configured locale codes
    locales,          // LocalesMap — metadata (nativeName, dir, currencyCode, ordinalForms)
    isReady,          // true when the provider is ready to render; missing locale data falls back to source text
    dir,              // 'ltr' | 'rtl' — text direction for the active locale
    t,                // Reactive translate function — use inside components
    hasTranslation,   // (text: string) => boolean
    getDisplayName,   // (targetLocale: string, viewingLocale?: string) => string
    ordinal,          // (value: number, gender?: string) => string
  } = useVocoder();

  return (
    <select value={locale} onChange={(e) => setLocale(e.target.value)}>
      {availableLocales.map((code) => (
        <option key={code} value={code}>
          {getDisplayName(code)} ({locales?.[code]?.nativeName})
        </option>
      ))}
    </select>
  );
}
```

**`t` vs global `t()`**: `useVocoder().t` re-renders automatically when the locale changes and is safe to call during render. The global `t()` export does not subscribe to React and should be used in callbacks, utilities, and non-React contexts.

---

## Locale Selector

A pre-built floating locale switcher, shipped as a separate entry point to avoid bundling Radix UI unless you need it:

```tsx
import { LocaleSelector } from '@vocoder/react/locale-selector';

// Floating bottom-right selector
<LocaleSelector position="bottom-right" />

// Custom appearance
<LocaleSelector
  position="top-right"
  background="#0f172a"
  color="#ffffff"
  iconSize={20}
  sortBy="native"
/>
```

Requires peer dependencies:

```bash
npm install @radix-ui/react-dropdown-menu lucide-react
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `position` | `'top-left' \| 'top-right' \| 'bottom-left' \| 'bottom-right'` (or aliases `tl` `tr` `bl` `br`) | — | Fixed position on the screen |
| `background` | `string` | `light-dark(#ffffff, #1a1a1a)` | Button and dropdown background color. When provided without `color`, LocaleSelector auto-picks a readable foreground color. |
| `color` | `string` | `light-dark(#1a1a1a, #ffffff)` | Button and dropdown text/icon color. Explicit values are trusted as-is and are not auto-corrected. |
| `className` | `string` | — | Additional CSS class on the root element |
| `iconSize` | `number` | — | Globe icon size in pixels |
| `locales` | `LocalesMap` | — | Override locale metadata (auto-generated by CLI if omitted) |
| `sortBy` | `'source' \| 'native' \| 'translated'` | `'native'` | Sort order: by English names, native names, or names translated into the viewing locale |

---

## Server utilities (`@vocoder/react/server`)

### `getLocaleDir(locale, locales)`

Returns the text direction for a locale. Use this in Next.js App Router layouts to set `dir` on the `<html>` tag before the client hydrates — `VocoderProvider` handles `dir` on the client, but the server render needs it independently.

```tsx
// app/layout.tsx
import { cookies } from 'next/headers';
import { VocoderProvider } from '@vocoder/react';
import { getLocaleDir } from '@vocoder/react/server';
import manifest from '@/locales/manifest.json';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const locale = cookieStore.get('vocoder_locale')?.value ?? manifest.sourceLocale;
  const translations = (await import(`@/locales/${locale}.json`)).default;
  const dir = getLocaleDir(locale, manifest.locales);
  return (
    <html lang={locale} dir={dir}>
      <body>
        <VocoderProvider
          manifest={manifest}
          initialLocale={locale}
          initialTranslations={translations}
          loadLocale={(l) => import(`@/locales/${l}.json`).then((m) => m.default)}
        >
          {children}
        </VocoderProvider>
      </body>
    </html>
  );
}
```

| Parameter | Type | Description |
|---|---|---|
| `locale` | `string` | The locale code to look up |
| `locales` | `Record<string, { isRTL?: boolean; dir?: string }>` | Locale metadata map — pass `manifest.locales` |

Returns `'rtl'` when the locale has `isRTL: true` or `dir: 'rtl'`, otherwise `'ltr'`.

---

## Preview mode

Preview mode lets you ship Vocoder to production but keep it inactive by default. It is opt-in: only visitors who explicitly enable it see translated content. This is useful for QA, stakeholder review, or staged rollouts before a full translation launch.

### How it works

`@vocoder/plugin` accepts a `preview` option. When `preview: true`, the build constant `__VOCODER_PREVIEW__` is set to `true`, which flips `PREVIEW_MODE` at runtime. In preview mode the SDK is only active for users who have the `vocoder_preview=true` cookie set.

The `?vocoder_preview=true` URL parameter sets that cookie and then strips itself from the URL. `VocoderProvider` handles this automatically — you do not call `syncPreviewQueryParam` directly.

### Exports

`PREVIEW_MODE`, `isPreviewEnabled`, and `isVocoderEnabled` are exported from `@vocoder/react`:

```ts
import { PREVIEW_MODE, isPreviewEnabled, isVocoderEnabled } from '@vocoder/react';
```

| Export | Type | Description |
|---|---|---|
| `PREVIEW_MODE` | `boolean` | `true` when the build was compiled with `preview: true` in the plugin config. Compile-time constant — `false` in normal production builds. |
| `isPreviewEnabled(cookieString?)` | `(string?) => boolean` | `true` when the visitor has opted in via the `vocoder_preview=true` cookie. Pass the raw cookie string for server-side calls. |
| `isVocoderEnabled(cookieString?)` | `(string?) => boolean` | `true` when the SDK should be active — either `PREVIEW_MODE` is `false` (standard build), or the visitor has opted in. Use this to gate SSR translation logic. |

#### Gating SSR translation in Next.js

```tsx
// app/layout.tsx
import { cookies } from 'next/headers';
import { isVocoderEnabled } from '@vocoder/react';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const cookieString = cookieStore.toString();

  if (!isVocoderEnabled(cookieString)) {
    // Vocoder is in preview mode and this visitor hasn't opted in — render without translations
    return <html><body>{children}</body></html>;
  }

  // Normal SSR path with locale detection
  // ...
}
```

#### Enabling preview for a visitor

Append `?vocoder_preview=true` to any URL in the app. `VocoderProvider` reads the param on mount, writes the cookie, and redirects to the clean URL. To disable, append `?vocoder_preview=false`.

---

## `generateMessageHash(text, context?, formality?)`

Computes the same 7-character catalog key that the build plugin and extractor generate at compile time. Use this in custom tooling — import scripts, catalog validators, or test fixtures — when you need to construct or look up a message key outside the normal build pipeline.

```ts
import { generateMessageHash } from '@vocoder/react';

generateMessageHash('Hello, world!')               // → e.g. "3j8kq2a"
generateMessageHash('Save', 'button')              // → different key from "Save" alone
generateMessageHash('Save', 'noun')                // → different again
generateMessageHash('Submit', undefined, 'formal') // → separate key from informal
```

| Parameter | Type | Description |
|---|---|---|
| `text` | `string` | The source message text |
| `context` | `string` (optional) | Disambiguation context — must match the `context` prop on `<T>` |
| `formality` | `string` (optional) | `'formal'` or `'informal'`. Any other value (including `'auto'` and `undefined`) hashes identically. |

Returns a 7-character base-36 string. The algorithm is FNV-1a 32-bit, guaranteed identical between Node.js and browsers — the extractor and the runtime always produce the same key for the same inputs.

---

## Extractor: what gets extracted

`@vocoder/plugin` transforms `<T>` components at build time to inject `message`, `values`, and `components` props. Understanding what the extractor supports helps you write translatable code correctly.

### What works

| Child expression | Extracted as |
|---|---|
| Plain text | Literal text |
| `{name}` (identifier) | `{name}` ICU placeholder |
| `` `Hello ${name}` `` (template literal) | `Hello {name}` |
| `{user.name}` `{getLabel()}` (complex) | `{0}` positional placeholder; value injected automatically |
| `{42}` (numeric literal) | `"42"` inlined as text |
| `<a href="/docs">text</a>` (JSX element) | `<0>text</0>` component slot |

### What bails (T is not transformed — warn emitted)

| Pattern | Problem | Correct alternative |
|---|---|---|
| `<T>{isNew ? 'New' : 'Old'} item</T>` | Conditional produces different strings — no stable catalog key | `{isNew ? <T>New item</T> : <T>Old item</T>}` |
| `<T>Status: {flag && 'visible'}</T>` | Logical expression — not a stable unit | `<T>Status:</T> {flag && <T>visible</T>}` |
| `<T>Hello <T>world</T></T>` | Nested `<T>` — outer bails; inner extracts independently | `<T>Hello</T> <T>world</T>` or use a component slot for styled content |

### Skipped without extraction

| Expression | Reason |
|---|---|
| `{true}` `{false}` `{null}` | React renders nothing — no translation content |

---

## How it works

### Git-first delivery

The GitHub Action runs `@vocoder/cli translate` on each push. It extracts all `<T>` and `t()` calls from your source code, submits them to Vocoder for translation, and commits the result back to your repository as:

- `locales/manifest.json` — locale config (source locale, target locales, per-locale metadata including RTL flag and ordinal forms)
- `locales/{locale}.json` — flat `{ key: text }` map for each locale

The provider reads `manifest.json` at startup to determine available locales and metadata, then loads the active locale's JSON file. Switching locales dynamically imports the next locale's file via `loadLocale`.

Translation updates are picked up on the next page load — no rebuild or redeploy required.

### Translation key format

Each message is identified by a 7-character FNV-1a 32-bit hash of the source text (plus context when provided). The extractor computes these at extraction time; the provider uses the same hash to look up translations at runtime.

---

## TypeScript

All types are exported from `@vocoder/react`:

```ts
import type {
  ComponentSlot,         // ReactElement | ((children: ReactNode) => ReactNode)
  FormatMode,            // 'number' | 'integer' | 'percent' | 'compact' | 'currency' | 'date' | 'time' | 'datetime'
  LocaleInfo,            // { nativeName, dir?, currencyCode?, ordinalForms? }
  LocaleManifest,        // { version, sourceLocale, targetLocales, locales, updatedAt, fingerprint }
  LocaleManifestEntry,   // { nativeName, isRTL, currencyCode?, ordinalForms? }
  LocaleSelectorProps,
  LocalesMap,            // Record<string, LocaleInfo>
  TOptions,              // { context?, formality?, id? }
  TProps,
  TranslationsMap,
  VocoderContextValue,
  VocoderProviderProps,
} from '@vocoder/react';

// Runtime values (not types)
import {
  generateMessageHash, // (text, context?, formality?) => string — 7-char catalog key
  PREVIEW_MODE,        // boolean — compile-time constant, true when built with preview: true
  isPreviewEnabled,    // (cookieString?) => boolean
  isVocoderEnabled,    // (cookieString?) => boolean
} from '@vocoder/react';

// Server-only utilities
import { getLocaleDir } from '@vocoder/react/server';
import type { VocoderProviderServerProps } from '@vocoder/react/server';
```

---

## License

MIT
