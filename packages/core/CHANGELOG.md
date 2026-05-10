# @vocoder/core

## 0.3.0

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

## 0.2.0

### Minor Changes

- feat: @vocoder/core shared primitives, full test coverage, extractor restructure
  - New `@vocoder/core` package: hash, ICU formatting, cookie utilities, shared types
  - Moved hash, ICU, and cookie utilities from `@vocoder/react` into `@vocoder/core`
  - `VocoderTranslationData` now canonical in core; re-exported from config and plugin
  - Full unit test coverage across all packages (529 tests total)
  - Extractor internals split into shared/icu-builders, shared/roles, shared/transform, parse/react
  - New READMEs for core, config, extractor; updated react and root READMEs
  - Two-tier versioning: tooling packages fixed together, core and react version independently
