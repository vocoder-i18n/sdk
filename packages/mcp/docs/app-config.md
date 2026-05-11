# App Configuration: API Key and appId

## Structure: One Project, One or More Apps

Vocoder's model:

```
Organization (workspace)
  └── Project (one per repo)
        ├── App 1 — appDir: ""         (whole-repo or single-app)
        ├── App 2 — appDir: "apps/web" (monorepo)
        └── App 3 — appDir: "apps/api" (monorepo)
```

- **Project** — represents the repo. Owns the API key, source locale, target locales, and target branches.
- **App** — represents one translatable directory within the repo. Has its own `appId`. A single-app repo has one app with `appDir: ""`.

---

## API Key

One API key per project (per repo). Shared by all apps in a monorepo.

```bash
# .env at the repo root (never commit this)
VOCODER_API_KEY=vca_...
```

The build plugin and CLI both read `VOCODER_API_KEY` from the environment. In CI/CD, set it as a secret environment variable.

**Generating a key:** Run `vocoder init` for first-time setup. For an existing app, run `vocoder regenerate-key` — requires admin or owner role.

**Key rotation:** `vocoder regenerate-key` generates a new key. The new key is active immediately. Update `.env` and any CI/CD secrets, then restart the MCP server (`/mcp reset` or editor restart) to reload.

---

## `vocoder.config.ts` and `appId`

Each app directory gets its own `vocoder.config.ts`. The `appId` tells the build plugin which app's translations to load.

### Single-app repo

```ts
// vocoder.config.ts (at repo root)
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  appId: 'app_abc123',
  localesPath: 'src/locales',
  targetBranches: ['main'],
});
```

### Monorepo

```ts
// apps/web/vocoder.config.ts
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  appId: 'app_web456',
  localesPath: 'src/locales',
  targetBranches: ['main'],
});
```

```ts
// apps/api/vocoder.config.ts
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  appId: 'app_api789',
  localesPath: 'src/locales',
  targetBranches: ['main'],
});
```

Each `appId` is unique. The API key is the same across all apps in the monorepo — set `VOCODER_API_KEY` once at the repo root.

---

## Finding appIds

`vocoder_app_create` returns the `apps` array with `appId` per directory. `vocoder_regenerate_key` also returns the current `apps` array.

If you need to check which appId maps to which directory without regenerating, run `vocoder app` (shows current config).

---

## What the Build Plugin Does with appId

At build time, the plugin:
1. Reads `appId` from `vocoder.config.ts`
2. Fetches translations for that app from the Vocoder CDN
3. Bundles them as code-split JS chunks alongside your app

Without a valid `appId`, the plugin cannot fetch translations — the app will load with source text only.

---

## Common Setup Issues

**`appId` missing from config** — translations load from CDN at runtime (fallback) rather than being bundled. Add `appId` to `vocoder.config.ts`.

**Wrong `appId`** — translations for the wrong app load. Each app directory must use its own `appId`, not another app's.

**`VOCODER_API_KEY` not set in CI** — the GitHub Actions workflow will fail to authenticate. Set the key as a repository secret (Settings → Secrets and variables → Actions).

**Key rotated but MCP server not restarted** — `vocoder_status` and `vocoder_sync` return 401. Tell the user to update `VOCODER_API_KEY` in their MCP environment config and restart their editor.
