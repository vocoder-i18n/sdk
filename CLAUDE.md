# CLAUDE.md - Vocoder SDK

This file provides guidance to Claude Code when working with the Vocoder SDK monorepo.

**Keep this file current.** When making changes that affect bundling policy, package structure, versioning strategy, local dev workflow, or any other section here — update the relevant section before marking the task complete. Stale guidance is worse than no guidance.

## Project Structure

pnpm workspace monorepo:

```
sdk/
├── packages/
│   ├── core/       # @vocoder/core — shared primitives: hash, ICU formatting, cookies, types
│   ├── config/     # @vocoder/config — defineConfig + re-exports from core
│   ├── extractor/  # @vocoder/extractor — Babel AST string extractor (bundled into plugin + cli)
│   ├── plugin/     # @vocoder/plugin — build plugin (Vite, Next.js, Webpack, Rollup, esbuild)
│   ├── react/      # @vocoder/react — components, hooks, provider, locale selector
│   ├── cli/        # @vocoder/cli — project setup, string extraction, translation sync
│   └── mcp/        # @vocoder/mcp — MCP server
└── pnpm-workspace.yaml
```

## Package Versioning (Two-Tier via Changesets)

Packages version in two independent groups:

| Group | Packages | Why |
|---|---|---|
| **Tooling** (locked together) | `cli`, `config`, `extractor`, `mcp`, `plugin` | These share API contracts with the backend. If `cli` and `plugin` bundle different extractors they produce different fingerprints → translations unreachable (404). |
| **Runtime** (independent) | `core`, `react` | Breaking API changes deserve semver majors without forcing a tooling re-release. |

**Release workflow:**

```bash
# 1. Describe what changed (bump level applies to affected group)
pnpm changeset

# 2. Apply versions
pnpm changeset version

# 3. Build + publish
pnpm release
```

**Rules:**
- Never manually edit `version` in individual `package.json` files — let `changeset version` do it
- Never publish a single package in isolation — always publish all via `pnpm release`
- `@vocoder/extractor`, `@vocoder/config`, and `@vocoder/core` are bundled into plugin and CLI (`noExternal` in tsup). Keep them in `devDependencies` in those packages, not `dependencies`

## Bundling Policy

| Package | Bundles extractor? | Bundles config? | Bundles core? |
|---|---|---|---|
| `@vocoder/plugin` | yes (`noExternal`) | yes | yes |
| `@vocoder/cli` | yes (`noExternal`) | yes | yes |
| `@vocoder/extractor` | no (is the extractor) | no | no (runtime dep) |
| `@vocoder/react` | no | no | no (runtime dep) |
| `@vocoder/core` | no | no | n/a (is core) |

Plugin and CLI are fully self-contained — consumers install nothing extra. Do not move extractor, config, or core back to runtime `dependencies` in plugin or cli.

`@vocoder/react` and `@vocoder/extractor` declare `@vocoder/core` as a real runtime dependency (users install it). Plugin and CLI bundle core via `noExternal` so they remain self-contained.

`VocoderTranslationData` is the canonical type in `@vocoder/core/src/types.ts`. Both `@vocoder/config` and `@vocoder/plugin` re-export it from core — there is no longer a duplicate local copy to keep in sync.

## Local Dev (yalc)

The `dev-sdk.cjs` / `dev-sdk.js` scripts in consumer projects rebuild ALL packages whenever any dist changes, then push all yalc-managed packages. This ensures bundled extractor stays in sync across plugin and cli.

**Do not** split packages into independent watch-and-push — they must all rebuild together.

Run translate via `pnpm exec vocoder translate` or `pnpm run translate`, never `npx @vocoder/cli translate` (pulls published npm, not local build).

## README Synchronization

When modifying any user-facing API, update the corresponding README.

| README | Update when... |
|---|---|
| **README.md** (root) | Adding/removing packages, changing overall quick start, cross-package behavior |
| **packages/core/README.md** | Adding/changing exports from `@vocoder/core` |
| **packages/react/README.md** | Adding/changing components, props, hooks, provider behavior |
| **packages/plugin/README.md** | Changing bundler setup, fingerprint computation, env vars, build-time constants |
| **packages/cli/README.md** | Adding/changing CLI commands, flags, sync modes, extraction behavior |

Style:
- Document what exists today. No planned features, migration history, or how things used to work.
- Lead with usage examples. Code first, explain after.
- Use tables for props/options/flags.
- No emojis in READMEs.
- Never mention competitors in documentation or code.
- Each package README is self-contained.

## CLI TUI Output Standards

All CLI command output must follow these conventions. Apply them without prompting when working in `packages/cli/`.

### Log Levels

| Function | Renders | When to use |
|---|---|---|
| `p.log.success(msg)` | ✓ green | Primary completed step or result line. Prefer simple output such as `Label: value` or a short completed sentence. |
| `p.log.warn(msg)` | ▲ yellow | Non-fatal condition — operation continues. What happened and why it matters. |
| `p.log.error(msg)` | ✗ red | Fatal condition — `return 1` follows within a few lines. Never used for warnings. |
| `p.log.info(msg)` | ℹ dim | Supplementary detail only: list items, recovery steps after an error, `""` for blank spacing. Never the primary message. |
| `p.log.message(msg)` | (none) | Undecorated text: `chalk.bold("Section:")` headers, numbered/bulleted lists. |

**Rule:** never use `p.note()`.

**Rule:** when working in `packages/cli`, use the shared `CommandSession` helper instead of calling `@clack/prompts` primitives ad hoc from top-level commands.

**Rule:** when exiting with code 1, the primary signal is always `p.log.error()` or `spinner.stop(msg, 1)` — never `p.log.warn()` alone. Use `p.log.warn()` only when the function continues after the warning.

### Inline Styling

| Construct | Use for |
|---|---|
| `highlight(value)` | Identifiers and discrete values that a user will scan for: project names, app dirs, locale codes, branch names, file paths, string counts, env var names, commands, API keys, emails, URLs. **Not** for prose text, error sentences, or API-returned descriptions. |
| `chalk.bold(text)` | Standalone label text only: `p.intro()` title, `p.log.message()` section headers |
| `chalk.red(text)` | `p.outro()` only, for fatal-exit messages that must stand out |
| `dim(text)` | Structural chrome only: separators, `printCommand()` decorations |
| `chalk.green("✓")` / `chalk.red("✗")` | Inline per-item status within formatted result strings |

**Rule:** never call `chalk.bold()` inside `p.log.success/warn/error/info()` — use `highlight()` instead.

**Rule:** prefer `Label: value` rows for summaries and steady-state output. Keep labels plain text and highlight only the dynamic values that users need to scan.

### Spinners

- `spinner.start("Verb-ing noun…")` — present participle, trailing `…` (Unicode ellipsis, not `...`)
- `spinner.stop("Result line")` — no trailing ellipsis; usually a short completed sentence or `Label: value`
- `spinner.stop("Terse error", 1)` — exit code `1` for all spinner failures; message is a short noun phrase
- Never call `p.log.*` while a spinner is running — stop the spinner first

### Command Entry / Exit

- Every top-level command must start through `CommandSession("Command Title")`
- Every exit path must call `p.outro()` immediately before returning — no silent returns
- `p.outro("")` — clean exit requiring no message
- `p.outro(chalk.red("Fatal: reason"))` — fatal build-blocking exit that must stand out
- `p.cancel("message")` — user-initiated cancellation only

### Error + Guidance Pattern

```ts
// Fatal — no spinner running
p.log.error("What failed.");
p.log.info("  Run `vocoder command` to recover.");
p.outro("");
return 1;

// Fatal — spinner was running
spinner.stop("Terse failure noun", 1);
for (const line of getGuidanceLines()) p.log.info(line);
p.outro("");
return 1;

// Limit error (structured guidance)
spinner.stop(limitError.message, 1);
for (const line of getLimitErrorGuidance(limitError)) p.log.info(line);
p.outro("");
return 1;
```

Guidance / recovery lines always use `p.log.info()`. Never `p.log.warn()` after a fatal signal.

### Information Density

One concept, one line. Never state the same fact in multiple places.

**No-repeat rule:** spinner stop, subsequent log calls, and outro are all visible to the user in sequence. If the spinner stop says X, the next log line must not restate X. If `p.log.error` names a recovery command, `p.outro` must not repeat it.

**Combine related quantities on one line:**
```ts
// ✗ — two info lines for one comparison
p.log.info(`Used this month: ${current.toLocaleString()} chars`);
p.log.info(`Required for this sync: ${required.toLocaleString()} chars`);

// ✓ — one line, same information
p.log.info(`Used: ${current.toLocaleString()} / Needed: ${required.toLocaleString()} chars`);
```

**Guidance cap:** maximum 2 `p.log.info()` lines after any single error.

**Outro scope:** `p.outro()` is forward-looking ("what to do next") or empty. Never use it to repeat an error reason or recovery command already shown by a log line.

**Guidance vs. summary:** info lines after an error tell the user WHAT TO DO — not a re-description of what went wrong (that's the error/spinner line's job).

### Monorepo Labels

- Single-app root: omit dir label from messages
- Named app dir: include `highlight(appDir)` in spinner start/stop and per-result lines
- Root app within a monorepo: display as `(root)`, not empty string

### Surface Consistency

- `bin.ts`, `packages/cli/README.md`, and command implementations must describe the same commands and flags
- Remove dead flags instead of documenting future behavior
- Keep examples aligned with the actual current output style

---

## TypeScript

Strict mode throughout. Build must succeed with zero errors before any task is complete.

```bash
pnpm build       # must succeed
pnpm test        # must pass
```

- Never use `any` — use `unknown` or proper types
- Files: `kebab-case.ts(x)`
- Components: `PascalCase`
- Functions: `camelCase`

## Essential Commands

```bash
pnpm install          # install dependencies
pnpm build            # build all packages
pnpm dev              # watch mode
pnpm test             # run all tests
pnpm lint             # biome lint
pnpm check:write      # biome lint + format (auto-fix)
```
