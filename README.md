# Vocoder SDK

The i18n SDK for Vocoder — components, build tooling, and AI assistant integration.

## Packages

| Package | Install | Description |
|---|---|---|
| [`@vocoder/react`](./packages/react) | `npm install @vocoder/react` | React components, hooks, and provider for rendering translations |
| [`@vocoder/cli`](./packages/cli) | `npm install -D @vocoder/cli` | CLI for project setup and translation sync |
| [`@vocoder/plugin`](./packages/plugin) | `npm install -D @vocoder/plugin` | Build plugin that injects translations at build time (Vite, Next.js, Webpack, Rollup, esbuild) |
| [`@vocoder/mcp`](./packages/mcp) | `npm install -D @vocoder/mcp` | MCP server for AI assistants — implements i18n tooling via the Model Context Protocol |
| [`@vocoder/core`](./packages/core) | bundled — most users don't install directly | Shared primitives: hash, ICU formatting, locale utilities, and types |
| [`@vocoder/config`](./packages/config) | bundled — most users don't install directly | `defineConfig` type helper for `vocoder.config.ts` |
| [`@vocoder/extractor`](./packages/extractor) | bundled — most users don't install directly | Babel AST extractor for `<T>` components and `t()` calls |

Most projects only need three packages: `@vocoder/react`, `@vocoder/cli`, and `@vocoder/plugin`. `@vocoder/core`, `@vocoder/config`, and `@vocoder/extractor` are bundled into the plugin and CLI — you do not install them separately unless you are building tooling on top of the SDK.

## Quick Start

```bash
npm install @vocoder/react
npm install -D @vocoder/cli @vocoder/plugin
npx @vocoder/cli init
```

`npx @vocoder/cli init` connects your repository to Vocoder and writes a `VOCODER_API_KEY` to your environment. No manual config files or key management in your source code.

### Add the build plugin

**Vite:**

```ts
// vite.config.ts
import vocoder from "@vocoder/plugin/vite";

export default defineConfig({
  plugins: [vocoder()],
});
```

**Next.js:**

```js
// next.config.js
const { withVocoder } = require("@vocoder/plugin/next");

module.exports = withVocoder({
  // your Next.js config
});
```

### Wrap your app with the provider

```tsx
import { VocoderProvider } from "@vocoder/react";

function App() {
  return (
    <VocoderProvider>
      {/* your app */}
    </VocoderProvider>
  );
}
```

### Mark strings for translation

```tsx
import { T, t } from "@vocoder/react";

// JSX content
<T>Hello, world!</T>

// JSX with variables
<T name={user.name}>Hello, {name}!</T>

// Non-JSX strings (toast messages, aria-labels, page titles)
const label = t("Save changes");
```

Push to git and Vocoder extracts your strings and translates them server-side. On the next build, the plugin fetches translations and injects them as virtual modules — code-split per locale, no runtime API calls needed for initial page load.

## Development

This is a pnpm workspace monorepo.

```bash
pnpm install    # install dependencies
pnpm build      # build all packages
pnpm dev        # watch mode for all packages
pnpm test       # run tests across all packages
```

All packages are versioned in lockstep. Use `pnpm changeset` to describe changes, then `pnpm changeset version` and `pnpm release` to publish.

## License

MIT
