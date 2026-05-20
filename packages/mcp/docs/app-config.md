# App Configuration: API Key and Project Structure

## Structure: One Project, One or More Apps

Vocoder's model:

```
Organization (workspace)
  └── Project (one per repo)
        ├── App — appDir: ""         (whole-repo or single-app)
        ├── App — appDir: "apps/web" (monorepo)
        └── App — appDir: "apps/api" (monorepo)
```

- **Project** — represents the repo. Owns the API key, source locale, target locales, and target branches.
- **App** — represents one translatable directory within the repo. Identified by its `appDir` path relative to the git root. A single-app repo has one app with `appDir: ""`.

---

## API Key

One API key per project (per repo). Shared by all apps in a monorepo.

```bash
# .env at the repo root (never commit this)
VOCODER_API_KEY=vcp_...
```

The build plugin and CLI both read `VOCODER_API_KEY` from the environment. In CI/CD, set it as a secret environment variable.

**Key format:** Project keys start with `vcp_`. The key encodes a short project identifier used to compute bundle fingerprints at build time.

**Generating a key:** Run `npx @vocoder/cli init` for first-time setup. For an existing app, run `npx @vocoder/cli regenerate-key` — requires admin or owner role.

**Key rotation:** `vocoder regenerate-key` generates a new key. The new key is active immediately. Update `.env` and any CI/CD secrets, then restart the MCP server (`/mcp reset` or editor restart) to reload.

---

## `vocoder.config.ts`

Each app directory can have a `vocoder.config.ts` that controls extraction patterns, locale file output, and translation behavior. It does **not** contain an `appId` — app identity is derived from the API key and directory path at build time.

### Single-app repo

```ts
// vocoder.config.ts (at repo root)
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  include: ['src/**/*.{ts,tsx}'],
  localesDir: 'src/locales',
  targetBranches: ['main'],
});
```

### Monorepo

```ts
// apps/web/vocoder.config.ts
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  include: ['src/**/*.{ts,tsx}'],
  localesDir: 'src/locales',
  targetBranches: ['main'],
});
```

```ts
// apps/api/vocoder.config.ts
import { defineConfig } from '@vocoder/config';

export default defineConfig({
  include: ['src/**/*.{ts,tsx}'],
  localesDir: 'src/locales',
  targetBranches: ['main'],
});
```

The same `VOCODER_API_KEY` is used across all apps in the monorepo — set it once at the repo root.

---

## How the Build Plugin Identifies an App

The build plugin does not read an `appId` from config. Instead it:

1. Reads `VOCODER_API_KEY` and extracts the `projectShortId` embedded in the key
2. Detects `appDir` — the path from the git root to the current working directory (empty string for single-app repos)
3. Extracts all source strings from the project
4. Computes a **fingerprint**: `sha256(projectShortId + ":" + appDir + ":" + sorted(keys)).slice(0, 12)`
5. Fetches the translation bundle from the CDN at `{cdnUrl}/{fingerprint}/bundle.json`, falling back to the API at `/api/t/{fingerprint}`

This means:
- No config file entry is needed to identify the app — the key + directory path are sufficient
- Fingerprints are content-addressed: changing a string changes the fingerprint, triggering a new bundle fetch
- Monorepo apps each get a distinct fingerprint because `appDir` differs

---

## Config Options Reference

| Field | Type | Description |
|---|---|---|
| `include` | `string[]` | Glob patterns for files to scan. Default: `["**/*.{tsx,jsx,ts,js}"]` |
| `exclude` | `string[]` | Glob patterns to skip |
| `targetBranches` | `string[]` | Branches that trigger translation |
| `localesDir` | `string` | Directory to write translated locale files after sync |
| `industry` | `string` | Domain classification for translation quality hints |
| `formality` | `"formal" \| "informal" \| "auto"` | Project-wide formality level |
| `onTranslationFailure` | `"fail" \| "proceed"` | Exit code behavior when translation fails. Default: `"proceed"` |

---

## Common Setup Issues

**`VOCODER_API_KEY` not set** — the build plugin logs a warning and builds with source text only. Set the key in `.env` (local) or as a CI secret.

**Wrong API key** — a key from a different project produces a different fingerprint and fetches the wrong bundle (or nothing). Each project has its own key.

**`VOCODER_API_KEY` not set in CI** — the GitHub Actions workflow will fail to authenticate. Set the key as a repository secret (Settings → Secrets and variables → Actions → New repository secret, name: `VOCODER_API_KEY`).

**Key rotated but MCP server not restarted** — `vocoder_config` and `vocoder_translate` return 401. Tell the user to update `VOCODER_API_KEY` in their MCP environment config and restart their editor (`/mcp reset`).

**Monorepo app not found** — ensure the build runs from the app's directory (e.g. `apps/web`), not the repo root. The `appDir` in the fingerprint is relative to the git root, so cwd must be inside the correct subdirectory.
