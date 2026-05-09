# @vocoder/extractor

Babel AST string extractor for Vocoder — extracts `<T>` components and `t()` calls from source files.

This package is bundled into `@vocoder/cli` and `@vocoder/plugin` — most users interact with it via `vocoder sync` and never need to install it directly.

---

## Installation

```bash
npm install @vocoder/extractor
# or
pnpm add @vocoder/extractor
```

Install directly only when building custom tooling: webhook pipelines, CI scripts, or build systems that need extraction outside the standard CLI and plugin flow.

---

## When to use directly

- Webhook pipelines that receive file content from a GitHub API response
- CI scripts that scan a project and report extracted strings
- Custom build systems that cannot use the Vite/Next.js/Webpack plugin
- Tools that need the raw `ExtractedString[]` array before it reaches the Vocoder API

For all other cases, `vocoder sync` (from `@vocoder/cli`) runs extraction automatically.

---

## API reference

### `extractFromContent(filename, content)`

Synchronous, pure function. Parses a single file's content and returns all translatable strings found in it. Does not read the filesystem — pass content you already have in memory.

```ts
import { extractFromContent } from "@vocoder/extractor";

const strings = extractFromContent("src/components/Button.tsx", sourceCode);
// [{ key: "a1b2c3d4e5f6", text: "Save changes", file: "src/components/Button.tsx", line: 12 }]
```

**Parameters**

| Parameter  | Type     | Description                                   |
|------------|----------|-----------------------------------------------|
| `filename` | `string` | Relative path used as the `file` field in results. Does not need to exist on disk. |
| `content`  | `string` | Raw source code to parse (TypeScript or JSX). |

**Returns:** `ExtractedString[]`

**`ExtractedString` shape**

| Field       | Type                                              | Description                                                                 |
|-------------|---------------------------------------------------|-----------------------------------------------------------------------------|
| `key`       | `string`                                          | Deterministic content-hash key, or the explicit `id` prop value if present. |
| `text`      | `string \| null`                                  | Source text. `null` for id-only entries (`<T id="key" />` with no children). |
| `file`      | `string`                                          | The `filename` argument passed in.                                          |
| `line`      | `number`                                          | Line number of the component or call in the source file.                    |
| `context`   | `string \| undefined`                             | Translation context from the `context` prop or option.                      |
| `formality` | `"formal" \| "informal" \| "neutral" \| "auto" \| undefined` | Formality hint for the translation engine.              |
| `uiRole`    | `string \| undefined`                             | Detected UI role (e.g. `"button_label"`, `"heading"`, `"input_placeholder"`). Omitted when role cannot be determined. |

**Bail cases — strings that are skipped**

The extractor performs static analysis only. It skips a `<T>` element and emits a console warning when it encounters:

- A nested `<T>` inside another `<T>` — the inner element is extracted independently; the outer one is skipped.
- A conditional expression (`a ? b : c`) or logical AND (`a && b`) directly inside a `<T>` — these produce different strings at runtime and cannot be represented as a single ICU template.
- A conditional or logical expression inside a template literal used as child content.

Skipped strings are not extracted and will not be submitted for translation. Restructure them as separate `<T>` elements or use plural/select props.

---

### `StringExtractor` class — `extractFromProject`

Scans a directory tree via glob patterns and extracts strings from all matching files. Async; reads files from the filesystem.

```ts
import { StringExtractor } from "@vocoder/extractor";

const extractor = new StringExtractor();

const strings = await extractor.extractFromProject(
  ["src/**/*.tsx", "src/**/*.ts"],
  "/absolute/path/to/project",
  ["src/**/*.test.tsx", "src/**/*.stories.tsx"],
);
```

**Parameters**

| Parameter        | Type                      | Default          | Description                                                          |
|------------------|---------------------------|------------------|----------------------------------------------------------------------|
| `pattern`        | `string \| string[]`      | required         | Glob pattern(s) for files to include. Resolved relative to `projectRoot`. |
| `projectRoot`    | `string`                  | `process.cwd()`  | Absolute path used as the glob base and for computing relative file paths in results. |
| `excludePattern` | `string \| string[]`      | `undefined`      | Additional glob pattern(s) to exclude, merged with the built-in ignore list. |

Built-in ignore list (always applied): `**/node_modules/**`, `**/.next/**`, `**/dist/**`, `**/build/**`.

Results are deduplicated by key — the first occurrence of each key is kept.

---

### `computeFingerprint(appShortCode, sourceKeys)`

Produces a deterministic 12-character hex fingerprint for a set of source keys.

```ts
import { computeFingerprint } from "@vocoder/extractor";

const keys = strings.map((s) => s.key);
const fingerprint = computeFingerprint("my-app", keys);
// "a1b2c3d4e5f6"
```

**Parameters**

| Parameter      | Type       | Description                                                                                         |
|----------------|------------|-----------------------------------------------------------------------------------------------------|
| `appShortCode` | `string`   | Short identifier for the app. Scopes the fingerprint so multiple apps in a monorepo don't collide.  |
| `sourceKeys`   | `string[]` | Array of extraction keys (not source texts). Pass `s.key` from `ExtractedString`, not `s.text`.    |

**Returns:** `string` — 12-character lowercase hex. Computed as `sha256(appShortCode + ":" + sorted(sourceKeys).join("\0")).slice(0, 12)`.

The fingerprint is a pure function of source content. It does not depend on git state or environment variables.

---

### `generateMessageHash(text, context?, formality?)`

Re-exported from `@vocoder/core`. Computes the stable content-hash key that `extractFromContent` uses as the default `key` value.

```ts
import { generateMessageHash } from "@vocoder/extractor";

const key = generateMessageHash("Save changes");
const formalKey = generateMessageHash("Save changes", undefined, "formal");
```

Pass the same arguments that appear in your source code to reproduce the key the extractor would assign.

---

### `buildPluralICU(props, ordinal?)` / `buildSelectICU(props)`

Build ICU MessageFormat strings from plural or select prop maps. These functions stay byte-for-byte identical to their counterparts in `@vocoder/react` so that extracted ICU keys match what the runtime produces.

```ts
import { buildPluralICU, buildSelectICU } from "@vocoder/extractor";

buildPluralICU({ one: "1 item", other: "{count} items" });
// "{count, plural, one {1 item} other {{count} items}}"

buildSelectICU({ _male: "He replied", _female: "She replied", other: "They replied" });
// "{value, select, male {He replied} female {She replied} other {They replied}}"
```

Exact-count keys (`_0`, `_1`, etc.) sort before CLDR categories (`one`, `other`, etc.) in plural ICU output.

---

### `loadVocoderConfig(cwd)` / `parseVocoderConfig(source)`

Load or parse a `vocoder.config.{ts,js,mjs,cjs,json}` file without executing it.

```ts
import { loadVocoderConfig, parseVocoderConfig } from "@vocoder/extractor";

// Read from disk — tries ts, js, mjs, cjs, json in that order
const config = loadVocoderConfig("/absolute/path/to/project");
// { include: ["src/**/*.tsx"], exclude: ["**/*.test.tsx"], localesPath: "public/locales" }

// Parse from a string — use this when content comes from a GitHub API response
const config2 = parseVocoderConfig(fileContentFromGitHub);
```

Both functions return `VocoderConfig | null`. They use Babel AST parsing and support both `export default { ... }` and `export default defineConfig({ ... })` forms. Neither executes the config file.

**`VocoderConfig` fields**

| Field            | Type       | Description                                  |
|------------------|------------|----------------------------------------------|
| `include`        | `string[]` | Glob patterns for files to extract from.     |
| `exclude`        | `string[]` | Glob patterns for files to skip.             |
| `targetBranches` | `string[]` | Git branches that trigger translation sync.  |
| `localesPath`    | `string`   | Path where locale JSON files are written.    |
| `appIndustry`    | `string`   | Industry hint for translation engine.        |
| `formality`      | `string`   | Default formality for the project.           |

---

## Supported syntax

The extractor recognises these patterns:

**`<T>` JSX component**

```tsx
// Static string
<T>Hello world</T>

// ICU placeholder via identifier
<T>Welcome, {name}</T>

// Plural props
<T one="1 item" other="{count} items" />

// Select props
<T _male="He replied" _female="She replied" other="They replied" />

// Ordinal
<T ordinal one="1st" two="2nd" other="{count}th" />

// Explicit id
<T id="nav.save">Save</T>

// Context and formality
<T context="button" formality="formal">Submit</T>

// Inline JSX children (rich text)
<T>Read the <a href="/docs">documentation</a></T>

// message prop (injected by the build plugin; also accepted manually)
<T id="a1b2" message="Hello, {name}">Hello, {name}</T>
```

**`t()` function**

```ts
// Imported directly from @vocoder/react
import { t } from "@vocoder/react";
t("Save changes");
t("Hello, {name}", { name });
t("Hello, {name}", { name }, { context: "greeting", formality: "formal" });
t("Hello, {name}", { name }, { id: "custom.key" });

// Destructured from useVocoder()
const { t } = useVocoder();
t("Save changes");
```

**Skipped patterns**

```tsx
// Nested <T> — outer bails, inner extracts independently
<T>Outer <T>Inner</T></T>

// Conditional expression — use separate <T> elements instead
<T>{isLoggedIn ? "Sign out" : "Sign in"}</T>

// Logical AND — use a conditional render instead
<T>{count > 0 && "Items found"}</T>

// Conditional inside template literal
<T>{`${a ? "x" : "y"} text`}</T>
```

---

## Note

This package is bundled into `@vocoder/cli` and `@vocoder/plugin` — most users interact with it via `vocoder sync`. Install `@vocoder/extractor` directly only when you need programmatic access to extraction outside those tools.
