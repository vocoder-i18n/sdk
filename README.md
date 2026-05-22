# Vocoder SDK

The i18n SDK for Vocoder — components, CLI tooling, and AI assistant integration.

## Packages

| Package | Install | Description |
|---|---|---|
| [`@vocoder/react`](./packages/react) | `npm install @vocoder/react` | React components, hooks, and provider for rendering translations |
| [`@vocoder/cli`](./packages/cli) | `npm install -D @vocoder/cli` | CLI for project setup, string extraction, and translation sync |
| [`@vocoder/mcp`](./packages/mcp) | `npm install -D @vocoder/mcp` | MCP server for AI assistants — implements i18n tooling via the Model Context Protocol |
| [`@vocoder/plugin`](./packages/plugin) | `npm install -D @vocoder/plugin` | Build plugin for CDN bundle delivery (Vite, Next.js, Webpack, Rollup, esbuild) |
| [`@vocoder/core`](./packages/core) | low-level package | Shared primitives: hash, ICU formatting, locale utilities, and types |
| [`@vocoder/config`](./packages/config) | low-level package | `defineConfig` type helper for `vocoder.config.ts` |
| [`@vocoder/extractor`](./packages/extractor) | low-level package | Babel AST extractor for `<T>` components and `t()` calls |

Most projects only need two packages: `@vocoder/react` and `@vocoder/cli`. The other packages are lower-level building blocks for custom tooling, build integration, or AI-assistant workflows.

## Quick Start

```bash
npm install @vocoder/react
npm install -D @vocoder/cli
npx @vocoder/cli init
```

`npx @vocoder/cli init` connects your repository to Vocoder, walks through workspace and language setup, optionally installs supporting packages, and writes a `VOCODER_API_KEY` plus a GitHub Actions workflow file.

### Mark strings for translation

```tsx
import { T, t } from "@vocoder/react";

// JSX content
<T>Hello, world!</T>

// JSX with variables
<T>Hello, {name}!</T>

// Non-JSX strings (toast messages, aria-labels, page titles)
const label = t("Save changes");
```

### Add the provider

```tsx
import manifest from "./locales/manifest.json";
import en from "./locales/en.json";
import { VocoderProvider } from "@vocoder/react";

function App() {
  return (
    <VocoderProvider
      manifest={manifest}
      initialLocale="en"
      initialTranslations={en}
      loadLocale={(locale) => import(`./locales/${locale}.json`).then((m) => m.default)}
    >
      {/* your app */}
    </VocoderProvider>
  );
}
```

Push to git. The GitHub Action extracts your strings, translates them, and commits `locales/manifest.json` and per-locale JSON files directly to your repository. The provider reads those files at runtime — no build step required to pick up new translations.

## Development

This is a pnpm workspace monorepo.

```bash
pnpm install    # install dependencies
pnpm build      # build all packages
pnpm dev        # watch mode for all packages
pnpm test       # run tests across all packages
```

The release process is managed with Changesets. `@vocoder/cli`, `@vocoder/config`, `@vocoder/extractor`, `@vocoder/mcp`, and `@vocoder/plugin` are versioned together; `@vocoder/core` and `@vocoder/react` may version independently. Use `pnpm changeset` to describe changes, then `pnpm changeset version` and `pnpm release` to publish.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup, testing, and release expectations.

## Security

See [SECURITY.md](./SECURITY.md) for how to report vulnerabilities privately.

## License

MIT
