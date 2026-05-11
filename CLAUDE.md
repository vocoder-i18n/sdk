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
