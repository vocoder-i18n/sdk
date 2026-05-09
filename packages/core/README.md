# @vocoder/core

Shared primitives for the Vocoder i18n SDK.

## Installation

```bash
npm install @vocoder/core
```

## When to use this package directly

Most users should install `@vocoder/react` instead — it re-exports everything from this package along with the React components and hooks.

Use `@vocoder/core` directly only when you are:

- Building a custom framework integration that does not use React
- Writing tooling (extractors, validators, migration scripts) that needs hash generation or ICU formatting without a React dependency
- Implementing a custom runtime that needs cookie utilities or locale matching

---

## API Reference

### `generateMessageHash(text, context?, formality?)`

Generates a stable 7-character base-36 message ID from source text. Produces the same output in Node.js and browsers. Used by the extractor at build time and the runtime in the browser — both always produce the same key for the same input.

```ts
import { generateMessageHash } from "@vocoder/core";

// Deterministic — same input always produces the same hash
generateMessageHash("Hello, world!");         // "3k2m9q1"

// Context disambiguates identical strings with different meanings
generateMessageHash("Save", "button label");  // different hash
generateMessageHash("Save", "dialog title");  // different hash

// Formality produces separate keys for register variants
generateMessageHash("Welcome back", undefined, "formal");   // hash A
generateMessageHash("Welcome back", undefined, "informal"); // hash B
generateMessageHash("Welcome back", undefined, "auto");     // same as no formality
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | `string` | yes | Source message text |
| `context` | `string` | no | Disambiguation string for identical text with different meanings |
| `formality` | `string` | no | `"formal"` or `"informal"` produce distinct hashes; `"auto"` and `undefined` hash identically |

Returns a 7-character `string` (base-36, zero-padded). Collision probability is approximately 0.002% across 10,000 strings.

---

### `formatICU(text, values, locale?)`

Formats an ICU MessageFormat string with interpolated values. Returns the raw `text` unchanged if parsing or formatting throws — the caller always receives a string, never an exception.

```ts
import { formatICU } from "@vocoder/core";

// Plural
formatICU(
  "{count, plural, one {# item} other {# items}}",
  { count: 1 },
  "en"
); // "1 item"

formatICU(
  "{count, plural, one {# item} other {# items}}",
  { count: 5 },
  "en"
); // "5 items"

// Select
formatICU(
  "{gender, select, male {He agreed} female {She agreed} other {They agreed}}",
  { gender: "female" },
  "en"
); // "She agreed"

// Simple interpolation
formatICU("Hello, {name}!", { name: "Maria" }, "es"); // "Hello, Maria!"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `text` | `string` | yes | ICU MessageFormat string |
| `values` | `Record<string, any>` | yes | Interpolation values keyed by placeholder name |
| `locale` | `string` | no | BCP 47 locale tag; defaults to `"en"` |

Returns a `string`. Parsed results are cached by `"locale:text"` key.

---

### `rewriteSelectordinalInICU(icu, ordinalForms, values)`

Rewrites any embedded `selectordinal` nodes in an ICU string using a locale's `ordinalForms` data before passing the string to `formatICU`. This is required when a `selectordinal` appears inside a larger sentence rather than as the sole top-level element, because translation providers store incorrect ordinal branches in those cases.

```ts
import { rewriteSelectordinalInICU, formatICU } from "@vocoder/core";

const rewritten = rewriteSelectordinalInICU(
  "Congrats on your {year, selectordinal, one {#st} two {#nd} few {#rd} other {#th}} anniversary!",
  ordinalForms, // from locale bundle
  { year: 3 }
);
const result = formatICU(rewritten, { year: 3 }, "en");
// "Congrats on your 3rd anniversary!"
```

Returns `icu` unchanged when the string contains no `"selectordinal"` substring (fast path) or when parsing throws.

This function is called automatically by `@vocoder/react` when rendering ordinals. See the `@vocoder/react` docs for usage via `ordinal()` and the `<T>` component.

---

### `formatValue(value, format, locale, options?)`

Formats a number or date value using `Intl.NumberFormat` or `Intl.DateTimeFormat`. Formatters are cached internally.

```ts
import { formatValue } from "@vocoder/core";

formatValue(1234567.89, "number",   "de");                         // "1.234.567,89"
formatValue(0.175,      "percent",  "en");                         // "17.5%"
formatValue(9876543,    "compact",  "en");                         // "9.9M"
formatValue(42.6,       "integer",  "fr");                         // "43"
formatValue(49.99,      "currency", "en", { currency: "USD" });    // "$49.99"
formatValue(new Date(), "date",     "ja", { dateStyle: "long" });  // "2026年5月9日"
formatValue(new Date(), "time",     "en");                         // "3:04 PM"
formatValue(new Date(), "datetime", "en", { dateStyle: "short", timeStyle: "short" }); // "5/9/26, 3:04 PM"
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `value` | `string \| number \| Date` | yes | The value to format |
| `format` | `FormatMode` | yes | One of the format modes listed below |
| `locale` | `string` | yes | BCP 47 locale tag |
| `options` | `FormatValueOptions` | no | Additional formatting options |

**Format modes:**

| Mode | Input type | Description |
|---|---|---|
| `"number"` | number | Locale-aware decimal formatting |
| `"integer"` | number | Rounded to zero decimal places |
| `"percent"` | number | Multiplies by 100 and appends percent sign |
| `"compact"` | number | Abbreviated notation (1.2M, 3.4K) |
| `"currency"` | number | Currency symbol and formatting; requires `options.currency` |
| `"date"` | Date / string / number | Date portion only |
| `"time"` | Date / string / number | Time portion only |
| `"datetime"` | Date / string / number | Date and time |

**`FormatValueOptions`:**

| Option | Type | Default | Description |
|---|---|---|---|
| `currency` | `string` | — | ISO 4217 currency code (e.g. `"USD"`); required when `format` is `"currency"` |
| `dateStyle` | `"full" \| "long" \| "medium" \| "short"` | `"medium"` | Date display style |
| `timeStyle` | `"full" \| "long" \| "medium" \| "short"` | `"short"` | Time display style |

---

### `getCookie(name, cookieString?)` / `getBestMatchingLocale(...)` / `setCookie(...)`

Cookie utilities and locale negotiation used by the Vocoder provider for locale detection and persistence.

```ts
import { getCookie, setBestMatchingLocale, setCookie, getBestMatchingLocale } from "@vocoder/core";

// Read a cookie (browser or server)
const locale = getCookie("vocoder_locale");                        // browser
const locale = getCookie("vocoder_locale", req.headers.cookie);   // server

// Write a cookie (browser only)
setCookie("vocoder_locale", "fr", { maxAge: 31536000, path: "/" });

// Negotiate the best supported locale from a preferred value
getBestMatchingLocale("en-US", ["en", "fr", "de"], "en"); // "en"
getBestMatchingLocale("pt-BR", ["pt", "en"],       "en"); // "pt"
getBestMatchingLocale("zh",    ["en", "fr"],        "en"); // "en" (fallback)
```

**`getCookie(name, cookieString?)`** — Reads a cookie by name. When `cookieString` is omitted it reads from `document.cookie` in the browser. Returns `null` when the cookie is absent or the environment is not a browser and no string was provided.

**`setCookie(name, value, options?)`** — Writes a cookie to `document.cookie`. No-ops in non-browser environments. Defaults: `maxAge` 1 year, `path` `/`, `sameSite` `"Lax"`, `secure` based on current protocol.

**`getBestMatchingLocale(preferredLocale, supportedLocales, fallback)`** — Returns the closest supported locale for a given preference. Tries exact match first, then language-only match (`"en-US"` → `"en"`), then any regional variant of the same language, then the fallback.

---

## Types

| Type | Description |
|---|---|
| `TranslationsMap` | Nested map of `locale → key → translated string` |
| `OrdinalSuffixes` | CLDR plural-category suffixes (`zero`, `one`, `two`, `few`, `many`, `other`) for suffix-based ordinals |
| `OrdinalForms` | Discriminated union: `{ type: "suffix"; suffixes: OrdinalSuffixes }` or `{ type: "word"; words: Record<string, Record<number, string>> }` |
| `LocaleInfo` | Metadata for a single locale: `nativeName`, optional `dir` (`"rtl"`), `currencyCode`, and `ordinalForms` |
| `LocalesMap` | Map of locale code → `LocaleInfo` |
| `FormatMode` | Union of valid format mode strings for `formatValue` |
| `TOptions` | Options for `<T>` and `t()`: `context`, `formality`, and `id` |
| `VocoderTranslationData` | Canonical translation bundle shape: `config` (source locale, target locales, locale metadata) + `translations` map + `updatedAt` |
| `FormatValueOptions` | Options for `formatValue`: `currency`, `dateStyle`, `timeStyle` |

---

Most users should install `@vocoder/react` which re-exports everything from this package.
