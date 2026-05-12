---
"@vocoder/cli": minor
"@vocoder/mcp": patch
---

Simplify `vocoder init`: write only two files (GitHub Actions workflow + API key to `.env.local`), remove `vocoder.config.ts` generation, rename workflow to `vocoder-translate.yml`, add `on-failure: proceed` input. Remove scaffold, write-config, and mcp-setup modules. MCP setup moved to next-steps output. TUI improvements: consistent spacing across all custom prompts, pre-selected value floated to top in locale selector, brand hex colors replaced with semantic chalk colors.
