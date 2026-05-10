# @vocoder/config

## 0.16.6

## 0.16.5

## 0.16.4

## 0.16.3

## 0.16.2

## 0.16.1

## 0.16.0

### Minor Changes

- Provider API improvements and SDK audit fixes
  - `VocoderProvider`: replace `cookies` prop with `initialLocale` and `preview` boolean props — server resolves cookie values and passes them down; provider normalizes initialLocale against available locales automatically
  - Remove `VocoderProviderServer` (RSC cannot provide context; was a no-op)
  - Move `DEFAULT_ORDINAL_ICU`, `buildPluralICU`, `buildSelectICU`, `PLURAL_CLDR`, `ALL_CLDR` to `@vocoder/core` — single source of truth for T.tsx and extractor
  - Add `applyOrdinalForms()` to `@vocoder/core` — shared ordinal suffix/word logic replaces triplicated implementations
  - Fix `context.t()` missing formality support — now uses full `TOptions` consistent with global `t()` and `<T>`
  - Fix `hasTranslation()` to be hash-only — remove hidden dual-mode (hash-or-source-text)
  - Fix preview query param: `syncPreviewQueryParam()` now reads `?vocoder=true|false` as intended
  - `Industry` type replaces `AppIndustry` (deprecated alias kept); adds travel, legal, government, nonprofit, other

### Patch Changes

- Updated dependencies
  - @vocoder/core@0.3.0

## 0.15.0

### Minor Changes

- feat: @vocoder/core shared primitives, full test coverage, extractor restructure
  - New `@vocoder/core` package: hash, ICU formatting, cookie utilities, shared types
  - Moved hash, ICU, and cookie utilities from `@vocoder/react` into `@vocoder/core`
  - `VocoderTranslationData` now canonical in core; re-exported from config and plugin
  - Full unit test coverage across all packages (529 tests total)
  - Extractor internals split into shared/icu-builders, shared/roles, shared/transform, parse/react
  - New READMEs for core, config, extractor; updated react and root READMEs
  - Two-tier versioning: tooling packages fixed together, core and react version independently

### Patch Changes

- Updated dependencies
  - @vocoder/core@0.2.0

## 0.14.1

### Patch Changes

- docs(react): overhaul README for accuracy and completeness

  Corrects outdated component type (was Record<string, ReactElement>), wrong tag
  format examples (<link> → <0>), and wrong sortBy default. Adds full coverage
  of plurals, select, ordinals, format prop, function slots, object component form,
  React elements in values, extractor behavior table, and TypeScript exports.

## 0.14.0

### Minor Changes

- feat: Lingui-style numeric component tags, function slots, expression safety

  **Tag format** (`<0>` replaces `<c0>`): Component placeholders in ICU strings now use Lingui-style numeric tags (`<0>`, `<1>`) instead of `<c0>`. The preprocessor normalises these to `<cN>` before ICU parse and restores afterward.

  **Function slots**: `components` prop now accepts render functions alongside React elements. `(children: ReactNode) => ReactNode` enables dynamic wrapper logic without a DOM element.

  **Object form**: `components` accepts `Record<number, ComponentSlot>` — sparse objects useful when skipping indices (`{ 0: <em />, 2: <strong /> }`).

  **React elements in values**: React elements passed via `values` are auto-promoted to self-closing component slots at render time — no manual `components` prop required.

  **Extractor expression safety**:
  - Numeric literals (`{42}`) inline as literal text instead of becoming positional placeholders
  - Boolean and null literals (`{true}`, `{null}`) are skipped — they render nothing
  - Conditional (`{a ? b : c}`) and logical (`{a && b}`) expressions trigger a bail with a warning — use `{cond ? <T>A</T> : <T>B</T>}` instead
  - Nested `<T>` inside `<T>` bails the outer element; the inner T extracts independently

## 0.13.4

## 0.13.3

### Patch Changes

- 8d3692e: Bold intro in sync command, highlight branch names and locale codes in sync log output.

## 0.13.2

## 0.13.1

### Patch Changes

- ec4fa6b: Apply Vocoder brand colors to CLI TUI output. Pink (#D51977) for named values (file paths, locale codes, branch names), blue (#2450A9) for bars and structural elements in custom prompts, orange (#FC5206) for active cursor indicators.

## 0.13.0

## 0.12.3

## 0.12.2

## 0.12.1

## 0.12.0

## 0.11.0

## 0.10.0

## 0.8.0

### Minor Changes

- Word-based ordinal support (Arabic, Hebrew), gender-aware ordinal() API, CSS-only LocaleSelector theming, extractor ICU builder exports, ordinalForms replacing ordinalSuffixes, backwards-compat shims removed.

## 0.7.0

### Patch Changes

- Add suffix-free ordinal API and `ordinal()` function

  `<T value={rank} ordinal />` no longer requires `one`/`two`/`few`/`other` suffix props. The extractor generates canonical English ordinal ICU internally; the pipeline replaces branches with locale-correct patterns from the ordinalSuffixes DB.

  New `ordinal(value)` function available as `useVocoder().ordinal()` (reactive, inside components) and as a named export `import { ordinal } from '@vocoder/react'` (global, outside React).

  Breaking: `<T value={rank} ordinal one="#st" two="#nd" few="#rd" other="#th" />` — suffix props are ignored when `ordinal` is present. Use `<T value={rank} ordinal />`.
