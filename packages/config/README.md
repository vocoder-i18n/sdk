# @vocoder/config

Vocoder project configuration — defines which files to extract strings from and project-level translation settings.

> This package is a peer dependency of `@vocoder/cli` and `@vocoder/plugin` — most users never install it directly.

## Installation

```bash
npm install @vocoder/config
```

## Quick start

```ts
// vocoder.config.ts
import { defineConfig } from "@vocoder/config";

export default defineConfig({
  include: ["src/**/*.{ts,tsx}"],
  exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.stories.{ts,tsx}"],
  targetBranches: ["main"],
  localesPath: "public/locales",
  appIndustry: "saas",
  formality: "neutral",
});
```

`defineConfig` is a type-only helper — it returns the config object unchanged and exists only to provide autocomplete and type checking in editors.

## VocoderConfig

| Property | Type | Default | Description |
|---|---|---|---|
| `appId` | `string` | — | Unique identifier written by `vocoder init`. Do not edit manually — the CLI uses this to identify which app to update during sync. |
| `include` | `string[]` | — | Glob patterns for files to scan for translatable strings. |
| `exclude` | `string[]` | — | Glob patterns to skip during extraction. |
| `targetBranches` | `string[]` | — | Git branches that trigger extraction and translation. Synced to the Vocoder dashboard on each push — change here to update. |
| `localesPath` | `string` | — | Directory where `vocoder sync` writes translated `{locale}.json` files. |
| `appIndustry` | `AppIndustry` | — | Industry classification for this app. Improves translation quality for domain-specific terminology and scopes the translation cache by industry. Synced to the app at extraction time. |
| `formality` | `Formality` | — | Project-wide default formality level. Can be overridden per-string with `<T formality="...">` on the AI plan. Synced to the app at extraction time. |

## AppIndustry values

| Value | Description |
|---|---|
| `"ecommerce"` | Retail, shopping, marketplaces |
| `"saas"` | Software-as-a-service, B2B tools |
| `"healthcare"` | Medical, clinical, health information |
| `"fintech"` | Finance, payments, banking |
| `"gaming"` | Games, interactive entertainment |
| `"education"` | Learning platforms, edtech |
| `"media"` | Publishing, streaming, news |
| `"productivity"` | Task management, collaboration, utilities |

## Formality values

| Value | Description |
|---|---|
| `"neutral"` | Neither formal nor informal — default for most apps |
| `"formal"` | Polite, professional register |
| `"informal"` | Casual, conversational register |
