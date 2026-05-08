# CLAUDE.md - Vocoder SDK

This file provides guidance to Claude Code when working with the Vocoder SDK monorepo.

**Keep this file current.** When making changes that affect bundling policy, package structure, versioning strategy, local dev workflow, or any other section here — update the relevant section before marking the task complete. Stale guidance is worse than no guidance.

## Project Structure

pnpm workspace monorepo:

```
vocoder-sdk/
├── packages/
│   ├── config/     # @vocoder/config — shared config types + defineConfig
│   ├── extractor/  # @vocoder/extractor — Babel AST string extractor (bundled into plugin + cli)
│   ├── plugin/     # @vocoder/plugin — build plugin (Vite, Next.js, Webpack, Rollup, esbuild)
│   ├── react/      # @vocoder/react — components, hooks, provider, locale selector
│   ├── cli/        # @vocoder/cli — project setup, string extraction, translation sync
│   └── mcp/        # @vocoder/mcp — MCP server
└── pnpm-workspace.yaml
```

## Package Versioning (Lockstep via Changesets)

All `@vocoder/*` packages are versioned in lockstep using the `fixed` group in `.changeset/config.json`. When any package changes, ALL packages publish at the same version.

**Why lockstep matters:** `@vocoder/plugin` and `@vocoder/cli` both bundle `@vocoder/extractor` into their dist. If they ship at different versions with different bundled extractors, they extract different string sets → produce different fingerprints → CLI sync translations are unreachable by the build plugin (404).

**Release workflow:**

```bash
# 1. Describe what changed (pick any bump level — all packages will match)
pnpm changeset

# 2. Apply versions — all packages bump to the same version
pnpm changeset version

# 3. Build + publish all packages
pnpm release
```

**Rules:**
- Never manually edit `version` in individual `package.json` files — let `changeset version` do it
- Never publish a single package in isolation — always publish all via `pnpm release`
- `@vocoder/extractor` and `@vocoder/config` are bundled into plugin and CLI (`noExternal` in tsup). Keep them in `devDependencies` in those packages, not `dependencies`

## Bundling Policy

| Package | Bundles extractor? | Bundles config? |
|---|---|---|
| `@vocoder/plugin` | yes (`noExternal`) | yes |
| `@vocoder/cli` | yes (`noExternal`) | yes |
| `@vocoder/extractor` | no (is the extractor) | no |
| `@vocoder/react` | no | no |

This means plugin and cli are fully self-contained — consumers install nothing extra. Do not move extractor or config back to runtime `dependencies` in plugin or cli.

`VocoderTranslationData` is defined in **two places** that must stay in sync:
- `@vocoder/config/src/index.ts` — canonical, imported by CLI
- `@vocoder/plugin/src/types.ts` — local copy, because plugin's DTS generator can't resolve `@vocoder/config` (not in plugin's devDeps)

If you change the shape in one, change the other.

## Local Dev (yalc)

The `dev-sdk.cjs` / `dev-sdk.js` scripts in consumer projects rebuild ALL packages whenever any dist changes, then push all yalc-managed packages. This ensures bundled extractor stays in sync across plugin and cli.

**Do not** split packages into independent watch-and-push — they must all rebuild together.

Run sync via `pnpm exec vocoder sync` or `pnpm run translate`, never `npx @vocoder/cli sync` (pulls published npm, not local build).

## README Synchronization

When modifying any user-facing API, update the corresponding README.

| README | Update when... |
|---|---|
| **README.md** (root) | Adding/removing packages, changing overall quick start, cross-package behavior |
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
