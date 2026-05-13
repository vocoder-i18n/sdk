import "dotenv/config";

import { NO_API_KEY_MESSAGE, createClient } from "./client.js";
import { dirname, join } from "node:path";
import { runAddLocale, runRemoveLocale } from "./tools/locales.js";
import { runInitComplete, runInitStart, runProjectCreate } from "./tools/create-project.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { runPull } from "./tools/pull.js";
import { runImplementI18n } from "./tools/implement-i18n.js";
import { runInitStatus } from "./tools/init-status.js";
import { runRegenerateKey } from "./tools/regenerate-key.js";
import { runSetup } from "./tools/setup.js";
import { runConfig } from "./tools/config.js";
import { runTranslate } from "./tools/translate.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const loadDoc = (name: string) => readFileSync(join(__dirname, "../docs", name), "utf8");

const server = new McpServer(
	{ name: "vocoder", version: "0.1.0" },
	{
		instructions: `You are a localization expert and an expert in the Vocoder i18n platform.

Your role is to autonomously implement internationalization in the user's project using the Vocoder SDK and ICU MessageFormat best practices. When the user asks you to set up, check, or fix i18n, take action — edit files, run commands, and complete the work. Do not list steps for the user to follow manually unless an action genuinely requires human input (browser authentication being the only expected case).

Key principles:
- Prefer <T> component for JSX content. Use t() for non-JSX strings (toast messages, aria-labels, window.title, etc.).
- Plurals and selects belong in <T> props (one/other, _male/_female), not in JavaScript ternaries.
- Wrap all visible UI strings. Skip: import paths, CSS classes, URLs, console.log, test files, technical HTML attributes.
- After implementing, always run vocoder_translate to extract strings and submit for translation.
- If VOCODER_API_KEY is missing or invalid, tell the user to run \`npx @vocoder/cli init\` in their terminal to set up their project, then add VOCODER_API_KEY to their .env and run /mcp reset to reload.

Reference resources (read when you need detail):
- vocoder://docs/sdk-reference — Full @vocoder/react API: <T> props, t(), useVocoder(), VocoderProvider, LocaleSelector, ordinal(), preferred patterns
- vocoder://docs/icu-patterns — ICU MessageFormat: plurals, selects, ordinals, rich text, formatting, anti-patterns
- vocoder://docs/t-function — When to use module-level t() vs useVocoder().t and how locale switching causes full retranslation
- vocoder://docs/framework-setup — Setup for Next.js App Router, Pages Router, Vite SPA, Remix — cookie detection, hydration, isReady
- vocoder://docs/rtl — RTL layout: applyDir, dir from context, getLocaleDir for SSR, Tailwind rtl: variants
- vocoder://docs/plugin-reference — Build plugin: framework setup, JSX transforms, virtual modules, injected constants
- vocoder://docs/extractor — How extraction works: AST parsing, bail cases, hash computation, vocoder translate
- vocoder://docs/troubleshooting — Debug common issues: missing translations, extraction failures, hydration mismatch, RTL
- vocoder://docs/app-config — API key, appId, and project/app structure: one API key per repo, each app directory gets its own appId in vocoder.config.ts
- vocoder://docs/github-action-setup — workflow file setup, VOCODER_API_KEY secret, failure behavior, multi-app`,
	},
);

// ── Resources ─────────────────────────────────────────────────────────────────

server.resource(
	"sdk-reference",
	"vocoder://docs/sdk-reference",
	{
		description:
			"Full @vocoder/react SDK reference: <T> props, t(), useVocoder() hook, VocoderProvider, LocaleSelector, VocoderProviderServer, getLocaleDir, ordinal(), build plugin setup. Includes preferred patterns and alternatives.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/sdk-reference", text: loadDoc("sdk-reference.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-icu-patterns",
	"vocoder://docs/icu-patterns",
	{
		description:
			"ICU MessageFormat patterns for Vocoder: plurals, selects, ordinals, rich text, number/date formatting, preferred vs alternative patterns, anti-patterns.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/icu-patterns", text: loadDoc("icu-patterns.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-t-function",
	"vocoder://docs/t-function",
	{
		description:
			"When to use module-level t() vs useVocoder().t: reactivity, locale switching, full retranslation, examples for each use case.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/t-function", text: loadDoc("t-function.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-framework-setup",
	"vocoder://docs/framework-setup",
	{
		description:
			"Setup guide for SSR vs SPA: Next.js App Router, Next.js Pages Router, Vite SPA, Remix. Cookie-based locale detection, hydration, isReady, locale persistence.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/framework-setup", text: loadDoc("framework-setup.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-rtl",
	"vocoder://docs/rtl",
	{
		description:
			"RTL (right-to-left) layout: applyDir, dir from useVocoder(), getLocaleDir for SSR, Tailwind rtl: variants, CSS logical properties, RTL locale list.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/rtl", text: loadDoc("rtl.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-plugin-reference",
	"vocoder://docs/plugin-reference",
	{
		description:
			"Build plugin reference: Next.js/Vite/Webpack/Rollup/esbuild setup, plugin options, JSX transformation, virtual modules, injected constants, branch detection.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/plugin-reference", text: loadDoc("plugin-reference.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-extractor",
	"vocoder://docs/extractor",
	{
		description:
			"How the string extractor works: Babel AST parsing, what gets extracted, natural JSX transformation, bail cases, hash computation, fingerprint, vocoder translate CLI.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/extractor", text: loadDoc("extractor.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-troubleshooting",
	"vocoder://docs/troubleshooting",
	{
		description:
			"Debugging common Vocoder issues: missing translations, extraction failures, LocaleSelector not showing, locale not persisting, hydration mismatch, RTL not applying, empty build bundles.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/troubleshooting", text: loadDoc("troubleshooting.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"app-config",
	"vocoder://docs/app-config",
	{
		description:
			"API key and appId setup: one API key per repo (VOCODER_API_KEY), each app directory gets its own appId in vocoder.config.ts. Covers single-app and monorepo layouts, key rotation, and common setup issues.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/app-config", text: loadDoc("app-config.md"), mimeType: "text/markdown" }],
	}),
);

server.resource(
	"vocoder-github-action-setup",
	"vocoder://docs/github-action-setup",
	{
		description:
			"GitHub Actions workflow setup: workflow file, VOCODER_API_KEY secret, failure behavior, multi-app repos, version pinning.",
		mimeType: "text/markdown",
	},
	async () => ({
		contents: [{ uri: "vocoder://docs/github-action-setup", text: loadDoc("github-action-setup.md"), mimeType: "text/markdown" }],
	}),
);

// ── Tools ──────────────────────────────────────────────────────────────────────

// vocoder_setup — inspect framework and return setup info.
// Works without an API key (local detection only).
server.tool(
	"vocoder_setup",
	"Detect the current app's framework and return everything needed to understand the Vocoder i18n setup: install commands, build plugin snippet, provider placement (exact file path), usage example, string-wrapping guidance, and the full SDK API reference. Call this first to assess the app. For a step-by-step implementation plan with file discovery, call vocoder_implement_i18n instead.",
	{
		sourceLocale: z
			.string()
			.optional()
			.describe('Source language code (default: "en")'),
		targetLocales: z
			.array(z.string())
			.optional()
			.describe('Target language codes, e.g. ["es", "fr", "de"]'),
	},
	async ({ sourceLocale, targetLocales }) => {
		try {
			const apiKey = process.env.VOCODER_API_KEY;
			const result = runSetup({ sourceLocale, targetLocales }, !!apiKey);
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Setup detection failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_init_status — check whether Vocoder is configured and the API key is valid.
// Call this first when the user asks about Vocoder setup status or if the key is missing.
server.tool(
	"vocoder_init_status",
	"Check whether Vocoder is configured for this app. Returns ready=true with app name and locale config if VOCODER_API_KEY is valid, or ready=false with instructions to run vocoder_init_start if not. Call this before any other tool when you are unsure whether the app is set up.",
	{},
	async () => {
		try {
			const api = createClient();
			const result = await runInitStatus(api);
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Status check failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_init_start — begin the Vocoder project setup flow.
// Checks for stored auth and performs an anonymous repo lookup first.
// Returns an authUrl for the user to open in their browser, or null if already authenticated.
server.tool(
	"vocoder_init_start",
	"Start the Vocoder app setup flow. Checks for an existing auth token, performs an anonymous lookup to detect if this repo already has a Vocoder app, then returns a browser URL for the user to sign in to Vocoder. If already authenticated, returns authUrl=null and mode='existing'. Call vocoder_init_complete after the user confirms they've completed the browser flow.",
	{},
	async () => {
		try {
			const result = await runInitStart({});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Init start failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_init_complete — poll for auth token after user completes the browser flow.
server.tool(
	"vocoder_init_complete",
	"Poll for the authentication token after the user completes the browser flow from vocoder_init_start. Pass the sessionId returned by vocoder_init_start. Once authenticated, ask the user for sourceLocale, targetLocales, and targetBranches, then call vocoder_create_project.",
	{
		sessionId: z.string().describe("sessionId returned by vocoder_init_start"),
	},
	async ({ sessionId }) => {
		try {
			const result = await runInitComplete({ sessionId });
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Init complete failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_create_project — create the Vocoder project and get the API key.
server.tool(
	"vocoder_create_project",
	"Create a Vocoder project for this repo and return the API key. Requires a completed auth session from vocoder_init_complete. Returns apiKey and step-by-step instructions. After calling this: append VOCODER_API_KEY to .env.local at the repo root, write .github/workflows/vocoder-translate.yml (template branches from targetBranches), add VOCODER_API_KEY as a GitHub repository secret (Settings → Secrets and variables → Actions), commit the workflow file, then call vocoder_implement_i18n to scaffold the SDK.",
	{
		sessionId: z.string().describe("sessionId from vocoder_init_start"),
		sourceLocale: z.string().describe('Source language code, e.g. "en"'),
		targetLocales: z.array(z.string()).describe('Target language codes, e.g. ["es", "fr"]'),
		targetBranches: z
			.array(z.string())
			.describe('Git branches that trigger translation, e.g. ["main"]'),
		projectName: z
			.string()
			.optional()
			.describe("App name (defaults to repo name)"),
	},
	async ({ sessionId, sourceLocale, targetLocales, targetBranches, projectName }) => {
		try {
			const result = await runProjectCreate({
				sessionId,
				sourceLocale,
				targetLocales,
				targetBranches,
				projectName,
			});
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Project creation failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_regenerate_key — generate a new API key for the Vocoder app in this repo.
// Requires admin or owner role. Uses stored auth token; throws if none (user must run CLI in terminal).
server.tool(
	"vocoder_regenerate_key",
	"Generate a new API key for the Vocoder app in this repo. Requires admin or owner role. Uses stored browser auth — if no auth token is found, instructs the user to run `vocoder regenerate-key` in their terminal instead. On success, returns the new key with instructions to write it to .env and restart the MCP server.",
	{},
	async () => {
		try {
			const result = await runRegenerateKey();
			return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Key regeneration failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_implement_i18n — generate a complete implementation plan.
// Returns exact file paths, install commands, provider setup, files to scan,
// string-wrapping patterns, and the full SDK reference. Use when ready to code.
server.tool(
	"vocoder_implement_i18n",
	"Generate a complete, step-by-step i18n implementation plan for the current app. Returns exact file paths to modify, install commands, provider setup code, a list of source files to scan for hardcoded strings, wrapping patterns with before/after examples, and the full @vocoder/react SDK reference. Call this when you are ready to implement i18n — it gives you everything needed to make code changes autonomously.",
	{
		sourceLocale: z
			.string()
			.optional()
			.describe('Source language code (default: "en")'),
		targetLocales: z
			.array(z.string())
			.optional()
			.describe('Target language codes, e.g. ["es", "fr", "de"]'),
		scope: z
			.string()
			.optional()
			.describe(
				'Subdirectory to limit file scanning, e.g. "src/components". Defaults to entire project.',
			),
		appDir: z
			.string()
			.optional()
			.describe(
				"App directory override for monorepos. Absolute path to the app package root.",
			),
	},
	async ({ sourceLocale, targetLocales, scope, appDir }) => {
		try {
			const result = runImplementI18n({ sourceLocale, targetLocales, scope, appDir });
			return {
				content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
			};
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Implementation plan generation failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_config — show project configuration.
server.tool(
	"vocoder_config",
	"Get the current Vocoder project configuration: project name, workspace, source locale, target locales, target branches, and sync policy.",
	{},
	async () => {
		const api = createClient();
		if (!api)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runConfig(api);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Config fetch failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_translate — extract strings and submit for translation.
server.tool(
	"vocoder_translate",
	"Extract all translatable strings from the current app and submit them to Vocoder for translation. Polls until translations are ready (up to 60 seconds).",
	{
		branch: z
			.string()
			.optional()
			.describe("Git branch to translate (auto-detected from git if not provided)"),
		force: z
			.boolean()
			.optional()
			.describe("Force re-translation even if strings are unchanged"),
	},
	async ({ branch, force }) => {
		const api = createClient();
		if (!api)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runTranslate({ branch, force }, api);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Translation failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_pull — download the current translation snapshot for inspection or debugging.
server.tool(
	"vocoder_pull",
	"Download the current translation snapshot for a branch. Returns a JSON map of { locale: { sourceText: translatedText } }. Use for inspection and debugging — the build plugin fetches bundles automatically at build time.",
	{
		branch: z
			.string()
			.optional()
			.describe('Branch to fetch translations for (default: "main")'),
		locale: z
			.string()
			.optional()
			.describe(
				'Specific locale to return (e.g. "es"). Returns all locales if omitted.',
			),
	},
	async ({ branch, locale }) => {
		const api = createClient();
		if (!api)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runPull({ branch, locale }, api);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Pull failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_list_locales — list all locales Vocoder supports.
server.tool(
	"vocoder_list_locales",
	"List all locales supported by Vocoder. Returns BCP 47 codes with display names. Call this before vocoder_add_locale to find the correct code for a language.",
	{},
	async () => {
		const apiKey = process.env.VOCODER_API_KEY;
		if (!apiKey) return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		const api = createClient()!;
		try {
			const result = await api.listLocales(apiKey);
			const lines = result.targetLocales.map((l: { code: string; name: string; nativeName?: string }) =>
				l.nativeName && l.nativeName !== l.name
					? `${l.code} — ${l.name} (${l.nativeName})`
					: `${l.code} — ${l.name}`,
			);
			return { content: [{ type: "text", text: lines.join("\n") }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to list locales: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_add_locale — add a new target language to the app.
server.tool(
	"vocoder_add_locale",
	'Add a new target locale to the Vocoder app. The locale must be a valid BCP 47 code (e.g. "fr", "de", "pt-BR", "zh-TW"). Use vocoder_list_locales to find the correct code for a language.',
	{
		locale: z
			.string()
			.describe('BCP 47 locale code to add, e.g. "fr" or "pt-BR"'),
	},
	async ({ locale }) => {
		const api = createClient();
		if (!api)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runAddLocale(locale, api);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to add locale: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_remove_locale — remove a target language from the app.
server.tool(
	"vocoder_remove_locale",
	'Remove a target locale from the Vocoder app. Pass the BCP 47 code of a currently-configured target locale (e.g. "fr", "de"). Use vocoder_config to see the current target locales before calling.',
	{
		locale: z
			.string()
			.describe('BCP 47 locale code to remove, e.g. "fr" or "pt-BR"'),
	},
	async ({ locale }) => {
		const api = createClient();
		if (!api)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runRemoveLocale(locale, api);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to remove locale: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

const transport = new StdioServerTransport();
await server.connect(transport);
