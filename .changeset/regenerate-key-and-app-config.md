---
"@vocoder/cli": minor
"@vocoder/mcp": minor
---

Add `vocoder regenerate-key` CLI command and `vocoder_regenerate_key` MCP tool.

- `vocoder regenerate-key`: dedicated command to rotate the project API key; requires admin or owner role (403 → friendly message); rewrites all `vocoder.config.ts` files with current appIds
- `vocoder init`: simplified — when repo is already set up, logs app name and points to `regenerate-key`; no longer offers key rotation inline
- `vocoder app`: added `--alias project` for backward compatibility; fixed help copy ("starter app" not "starter project")
- MCP: `vocoder_regenerate_key` tool using stored browser auth; throws with guidance if no stored token
- MCP: `vocoder://docs/app-config` resource — org→project→app structure, API key placement, appId in `vocoder.config.ts`, key rotation, common setup issues
- MCP: `vocoder_app_create` tool description and inline instructions now include `apps` array with `appId` per directory
- MCP: `vocoder_init_status`, `vocoder_init_start`, `vocoder_init_complete`, `vocoder_app_create` tools registered
- User-facing copy: "project" → "app" throughout CLI prompts, labels, and MCP tool descriptions
