# @vocoder/cli

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

### Patch Changes

- fix: validate vca* app key prefix instead of vcp*

## 0.13.1

### Patch Changes

- ec4fa6b: Apply Vocoder brand colors to CLI TUI output. Pink (#D51977) for named values (file paths, locale codes, branch names), blue (#2450A9) for bars and structural elements in custom prompts, orange (#FC5206) for active cursor indicators.

## 0.13.0

### Minor Changes

- feat: app-scoped API keys (vca\_) and CLI/MCP renames
  - Plugin requires vca* API keys; hard fail on non-vca* keys
  - CLI: getAppConfig, listApps, lookupAppByRepo, APIAppConfig, create-app command, --app-name flag
  - MCP: SyncBody updated with requestedMaxWaitMs/clientRunId/appIndustry, lookupAppByRepo

## 0.12.3

### Patch Changes

- Fix plan-limit reconnect to only offer projects already bound to the current repo. Removes locale/branch re-prompting when reconnecting.

## 0.12.2

### Patch Changes

- Remove `exclude` from generated `vocoder.config` — server-side defaults cover all common patterns.

## 0.12.1

### Patch Changes

- Store auth credentials in `~/.vocoder/auth.json` instead of `~/.config/vocoder/auth.json`.

## 0.12.0

### Minor Changes

- Add project management commands: `vocoder locales` (list/add/remove/supported), `vocoder project`, `vocoder translations`, and `vocoder create-project`. Plan limit errors now surface upgrade URLs across all CLI and MCP commands. New MCP tool: `vocoder_remove_locale`.

## 0.11.0

### Patch Changes

- feat(mcp): 3-tool init flow, workspace resolution fix, dotenv support
  - Split init into vocoder_init_start / vocoder_init_complete / vocoder_project_create matching CLI order
  - Workspace resolution moved to vocoder_project_create — prevents "already claimed" errors on re-runs
  - Stored auth token check in init_start skips browser flow when already authenticated
  - Install callback organizationId passed through to project_create, skipping workspace lookup
  - Added dotenv/config import so MCP process loads .env automatically
  - cli: removed apiUrl from AuthData (env var is source of truth); exported readAuthData/writeAuthData/clearAuthData from lib

## 0.10.0

### Minor Changes

- **cli:** Cleaner sync output — branch spinner removed, batch ID is now `--verbose`-only, stats condensed into a single contextual line per outcome, wait timeout humanised to seconds.

  **plugin:** Sync-on-startup in dev mode. When the dev server starts and no translations exist yet for the current fingerprint, the plugin automatically calls the sync API, waits for completion with a live progress indicator, and loads the translations before the server is ready — so the first run feels fully translated without needing a push first.

  **cli/plugin/extractor/config:** `appIndustry` and `formality` from `vocoder.config.ts` are now propagated to the sync API on every push, keeping translation context current with the project configuration.

## 0.8.0

### Minor Changes

- Word-based ordinal support (Arabic, Hebrew), gender-aware ordinal() API, CSS-only LocaleSelector theming, extractor ICU builder exports, ordinalForms replacing ordinalSuffixes, backwards-compat shims removed.

## 0.7.0

### Patch Changes

- Add suffix-free ordinal API and `ordinal()` function

  `<T value={rank} ordinal />` no longer requires `one`/`two`/`few`/`other` suffix props. The extractor generates canonical English ordinal ICU internally; the pipeline replaces branches with locale-correct patterns from the ordinalSuffixes DB.

  New `ordinal(value)` function available as `useVocoder().ordinal()` (reactive, inside components) and as a named export `import { ordinal } from '@vocoder/react'` (global, outside React).

  Breaking: `<T value={rank} ordinal one="#st" two="#nd" few="#rd" other="#th" />` — suffix props are ignored when `ordinal` is present. Use `<T value={rank} ordinal />`.
