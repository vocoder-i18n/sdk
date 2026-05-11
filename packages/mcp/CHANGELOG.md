# @vocoder/mcp

## 0.18.1

### Patch Changes

- Update repository URL: vocoder-sdk → sdk (github.com/vocoder-i18n/sdk).
- Updated dependencies
  - @vocoder/cli@0.18.1
  - @vocoder/extractor@0.18.1
  - @vocoder/plugin@0.18.1

## 0.18.0

### Minor Changes

- 237c29c: Add `vocoder regenerate-key` CLI command and `vocoder_regenerate_key` MCP tool.
  - `vocoder regenerate-key`: dedicated command to rotate the project API key; requires admin or owner role (403 → friendly message); rewrites all `vocoder.config.ts` files with current appIds
  - `vocoder init`: simplified — when repo is already set up, logs app name and points to `regenerate-key`; no longer offers key rotation inline
  - `vocoder app`: added `--alias project` for backward compatibility; fixed help copy ("starter app" not "starter project")
  - MCP: `vocoder_regenerate_key` tool using stored browser auth; throws with guidance if no stored token
  - MCP: `vocoder://docs/app-config` resource — org→project→app structure, API key placement, appId in `vocoder.config.ts`, key rotation, common setup issues
  - MCP: `vocoder_app_create` tool description and inline instructions now include `apps` array with `appId` per directory
  - MCP: `vocoder_init_status`, `vocoder_init_start`, `vocoder_init_complete`, `vocoder_app_create` tools registered
  - User-facing copy: "project" → "app" throughout CLI prompts, labels, and MCP tool descriptions

### Patch Changes

- Updated dependencies [bbb9642]
- Updated dependencies [237c29c]
  - @vocoder/cli@0.18.0
  - @vocoder/extractor@0.18.0
  - @vocoder/plugin@0.18.0

## 0.17.2

### Patch Changes

- Fix remaining "project" terminology in user-facing strings. Rename CLI `vocoder project` command to `vocoder app` (with `project` kept as alias for backward compatibility). Update log messages, TUI labels, error messages, and MCP tool descriptions to use "app" consistently.
- Updated dependencies
  - @vocoder/cli@0.17.2
  - @vocoder/extractor@0.17.2
  - @vocoder/plugin@0.17.2

## 0.17.1

### Patch Changes

- Rename `vocoder_project_create` → `vocoder_app_create` to match user-facing "app" terminology. Fix `ProjectCreateResult` to include `apps: Array<{ appDir, appId }>` from the actual API response. Update instructions to include ready-to-write `vocoder.config.ts` content with the correct `appId` per app.
  - @vocoder/cli@0.17.1
  - @vocoder/extractor@0.17.1
  - @vocoder/plugin@0.17.1

## 0.17.0

### Minor Changes

- Register init tools: `vocoder_init_status`, `vocoder_init_start`, `vocoder_init_complete`, `vocoder_project_create`. Adds anonymous repo pre-lookup to init_start so existing apps are surfaced before auth. Adds `instructions` to ProjectCreateResult telling the agent exactly what to write to disk after getting the API key.

### Patch Changes

- @vocoder/cli@0.17.0
- @vocoder/extractor@0.17.0
- @vocoder/plugin@0.17.0

## 0.16.6

### Patch Changes

- Add inline quick reference and locale selector guidance to `vocoder_implement_i18n` output. Agents that don't fetch MCP resources now get critical patterns (variable interpolation, plurals, rich text, extractor bail cases) directly in the tool response. Add `phase5_localeSelector` with built-in vs custom decision guidance.
  - @vocoder/cli@0.16.6
  - @vocoder/extractor@0.16.6
  - @vocoder/plugin@0.16.6

## 0.16.5

### Patch Changes

- Migrate user-facing "project" terminology to "app" across CLI and MCP. Renames `ProjectConfig` type to `AppConfig`. Updates all help text, error messages, MCP tool descriptions, and JSDoc comments.
- Updated dependencies
  - @vocoder/cli@0.16.5
  - @vocoder/extractor@0.16.5
  - @vocoder/plugin@0.16.5

## 0.16.4

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.16.4
  - @vocoder/extractor@0.16.4
  - @vocoder/plugin@0.16.4

## 0.16.3

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.16.3
  - @vocoder/extractor@0.16.3
  - @vocoder/plugin@0.16.3

## 0.16.2

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.16.2
  - @vocoder/extractor@0.16.2
  - @vocoder/plugin@0.16.2

## 0.16.1

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.16.1
  - @vocoder/extractor@0.16.1
  - @vocoder/plugin@0.16.1

## 0.16.0

### Patch Changes

- Provider API improvements and SDK audit fixes
  - `VocoderProvider`: replace `cookies` prop with `initialLocale` and `preview` boolean props — server resolves cookie values and passes them down; provider normalizes initialLocale against available locales automatically
  - Remove `VocoderProviderServer` (RSC cannot provide context; was a no-op)
  - Move `DEFAULT_ORDINAL_ICU`, `buildPluralICU`, `buildSelectICU`, `PLURAL_CLDR`, `ALL_CLDR` to `@vocoder/core` — single source of truth for T.tsx and extractor
  - Add `applyOrdinalForms()` to `@vocoder/core` — shared ordinal suffix/word logic replaces triplicated implementations
  - Fix `context.t()` missing formality support — now uses full `TOptions` consistent with global `t()` and `<T>`
  - Fix `hasTranslation()` to be hash-only — remove hidden dual-mode (hash-or-source-text)
  - Fix preview query param: `syncPreviewQueryParam()` now reads `?vocoder=true|false` as intended
  - `Industry` type replaces `AppIndustry` (deprecated alias kept); adds travel, legal, government, nonprofit, other

- Updated dependencies
  - @vocoder/extractor@0.16.0
  - @vocoder/cli@0.16.0
  - @vocoder/plugin@0.16.0

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
  - @vocoder/cli@0.15.0
  - @vocoder/extractor@0.15.0
  - @vocoder/plugin@0.15.0

## 0.14.1

### Patch Changes

- docs(react): overhaul README for accuracy and completeness

  Corrects outdated component type (was Record<string, ReactElement>), wrong tag
  format examples (<link> → <0>), and wrong sortBy default. Adds full coverage
  of plurals, select, ordinals, format prop, function slots, object component form,
  React elements in values, extractor behavior table, and TypeScript exports.

- Updated dependencies
  - @vocoder/cli@0.14.1
  - @vocoder/extractor@0.14.1
  - @vocoder/plugin@0.14.1

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

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.14.0
  - @vocoder/extractor@0.14.0
  - @vocoder/plugin@0.14.0

## 0.13.4

### Patch Changes

- Updated dependencies
  - @vocoder/plugin@0.13.4
  - @vocoder/cli@0.13.4
  - @vocoder/extractor@0.13.4

## 0.13.3

### Patch Changes

- 8d3692e: Bold intro in sync command, highlight branch names and locale codes in sync log output.
- Updated dependencies [8d3692e]
  - @vocoder/cli@0.13.3
  - @vocoder/extractor@0.13.3
  - @vocoder/plugin@0.13.3

## 0.13.2

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.13.2
  - @vocoder/extractor@0.13.2
  - @vocoder/plugin@0.13.2

## 0.13.1

### Patch Changes

- ec4fa6b: Apply Vocoder brand colors to CLI TUI output. Pink (#D51977) for named values (file paths, locale codes, branch names), blue (#2450A9) for bars and structural elements in custom prompts, orange (#FC5206) for active cursor indicators.
- Updated dependencies [ec4fa6b]
  - @vocoder/cli@0.13.1
  - @vocoder/extractor@0.13.1
  - @vocoder/plugin@0.13.1

## 0.13.0

### Minor Changes

- feat: app-scoped API keys (vca\_) and CLI/MCP renames
  - Plugin requires vca* API keys; hard fail on non-vca* keys
  - CLI: getAppConfig, listApps, lookupAppByRepo, APIAppConfig, create-app command, --app-name flag
  - MCP: SyncBody updated with requestedMaxWaitMs/clientRunId/appIndustry, lookupAppByRepo

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.13.0
  - @vocoder/plugin@0.13.0
  - @vocoder/extractor@0.13.0

## 0.12.3

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.12.3
  - @vocoder/extractor@0.12.3
  - @vocoder/plugin@0.12.3

## 0.12.2

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.12.2
  - @vocoder/extractor@0.12.2
  - @vocoder/plugin@0.12.2

## 0.12.1

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.12.1
  - @vocoder/extractor@0.12.1
  - @vocoder/plugin@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.12.0
  - @vocoder/extractor@0.12.0
  - @vocoder/plugin@0.12.0

## 0.11.0

### Minor Changes

- feat(mcp): 3-tool init flow, workspace resolution fix, dotenv support
  - Split init into vocoder_init_start / vocoder_init_complete / vocoder_project_create matching CLI order
  - Workspace resolution moved to vocoder_project_create — prevents "already claimed" errors on re-runs
  - Stored auth token check in init_start skips browser flow when already authenticated
  - Install callback organizationId passed through to project_create, skipping workspace lookup
  - Added dotenv/config import so MCP process loads .env automatically
  - cli: removed apiUrl from AuthData (env var is source of truth); exported readAuthData/writeAuthData/clearAuthData from lib

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.11.0
  - @vocoder/extractor@0.11.0
  - @vocoder/plugin@0.11.0

## 0.10.0

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.10.0
  - @vocoder/plugin@0.10.0
  - @vocoder/extractor@0.10.0

## 0.8.0

### Minor Changes

- Word-based ordinal support (Arabic, Hebrew), gender-aware ordinal() API, CSS-only LocaleSelector theming, extractor ICU builder exports, ordinalForms replacing ordinalSuffixes, backwards-compat shims removed.

### Patch Changes

- Updated dependencies
  - @vocoder/cli@0.8.0
  - @vocoder/extractor@0.8.0
  - @vocoder/plugin@0.8.0

## 0.7.0

### Patch Changes

- Add suffix-free ordinal API and `ordinal()` function

  `<T value={rank} ordinal />` no longer requires `one`/`two`/`few`/`other` suffix props. The extractor generates canonical English ordinal ICU internally; the pipeline replaces branches with locale-correct patterns from the ordinalSuffixes DB.

  New `ordinal(value)` function available as `useVocoder().ordinal()` (reactive, inside components) and as a named export `import { ordinal } from '@vocoder/react'` (global, outside React).

  Breaking: `<T value={rank} ordinal one="#st" two="#nd" few="#rd" other="#th" />` — suffix props are ignored when `ordinal` is present. Use `<T value={rank} ordinal />`.

- Updated dependencies
  - @vocoder/extractor@0.7.0
  - @vocoder/plugin@0.7.0
  - @vocoder/cli@0.7.0
