import "dotenv/config";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient, NO_API_KEY_MESSAGE } from "./client.js";

import { runImplementI18n } from "./tools/implement-i18n.js";
import { runInitStatus } from "./tools/init-status.js";
import { runInitComplete, runInitStart, runProjectCreate } from "./tools/project-init.js";
import { runAddLocale, runRemoveLocale } from "./tools/locale.js";
import { runSetup } from "./tools/setup.js";
import { runStatus } from "./tools/status.js";
import { runSync } from "./tools/sync.js";
import { runGetTranslations } from "./tools/translations.js";

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
- After implementing, always run vocoder_sync to extract strings and submit for translation.
- If VOCODER_API_KEY is missing or invalid, tell the user to run \`npx @vocoder/cli init\` in their terminal to set up their project, then add VOCODER_API_KEY to their .env and run /mcp reset to reload.

Reference resources (read when you need detail):
- vocoder://docs/sdk-reference — Full @vocoder/react API: <T> props, t(), useVocoder(), VocoderProvider, LocaleSelector, ordinal(), preferred patterns
- vocoder://docs/icu-patterns — ICU MessageFormat: plurals, selects, ordinals, rich text, formatting, anti-patterns
- vocoder://docs/t-function — When to use module-level t() vs useVocoder().t and how locale switching causes full retranslation
- vocoder://docs/framework-setup — Setup for Next.js App Router, Pages Router, Vite SPA, Remix — cookie detection, hydration, isReady
- vocoder://docs/rtl — RTL layout: applyDir, dir from context, getLocaleDir for SSR, Tailwind rtl: variants
- vocoder://docs/plugin-reference — Build plugin: framework setup, JSX transforms, virtual modules, injected constants
- vocoder://docs/extractor — How extraction works: AST parsing, bail cases, hash computation, vocoder sync
- vocoder://docs/troubleshooting — Debug common issues: missing translations, extraction failures, hydration mismatch, RTL`,
	},
);

// ── Resources ─────────────────────────────────────────────────────────────────

server.resource(
	"vocoder-sdk-reference",
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
			"How the string extractor works: Babel AST parsing, what gets extracted, natural JSX transformation, bail cases, hash computation, fingerprint, vocoder sync CLI.",
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

// ── Tools ──────────────────────────────────────────────────────────────────────

// vocoder_setup — inspect framework and return setup info.
// Works without an API key (local detection only).
server.tool(
	"vocoder_setup",
	"Detect the current project's framework and return everything needed to understand the Vocoder i18n setup: install commands, build plugin snippet, provider placement (exact file path), usage example, string-wrapping guidance, and the full SDK API reference. Call this first to assess the project. For a step-by-step implementation plan with file discovery, call vocoder_implement_i18n instead.",
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
	"Check whether Vocoder is configured for this project. Returns ready=true with app name and locale config if VOCODER_API_KEY is valid, or ready=false with instructions to run vocoder_init_start if not. Call this before any other tool when you are unsure whether the project is set up.",
	{},
	async () => {
		try {
			const client = createClient();
			const result = await runInitStatus(client);
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
	"Start the Vocoder project setup flow. Checks for an existing auth token, performs an anonymous lookup to detect if this repo already has a Vocoder app, then returns a browser URL for the user to authenticate. If already authenticated, returns authUrl=null and mode='existing'. Call vocoder_init_complete after the user confirms they've completed the browser flow.",
	{
		mode: z
			.enum(["install", "link"])
			.optional()
			.describe(
				'"install" (default): installs Vocoder GitHub App + authenticates in one step. "link": GitHub OAuth only — use when the GitHub App is already installed.',
			),
	},
	async ({ mode }) => {
		try {
			const result = await runInitStart({ mode });
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
	"Poll for the authentication token after the user completes the browser flow from vocoder_init_start. Pass the sessionId returned by vocoder_init_start. Once authenticated, ask the user for sourceLocale, targetLocales, and targetBranches, then call vocoder_app_create.",
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

// vocoder_app_create — create the Vocoder app and get the API key.
server.tool(
	"vocoder_app_create",
	"Create a Vocoder app for this repo and return the API key. Requires a completed auth session from vocoder_init_complete. Returns apiKey, app config including appId(s), and step-by-step instructions for what to write to disk. After calling this, write VOCODER_API_KEY to .env and vocoder.config.ts with the appId, then call vocoder_implement_i18n to scaffold the SDK.",
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

// vocoder_status — show app config and health.
server.tool(
	"vocoder_status",
	"Get the current Vocoder app status: app name, source locale, target locales, target branches, and sync policy.",
	{},
	async () => {
		const client = createClient();
		if (!client)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runStatus(client);
			return { content: [{ type: "text", text }] };
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

// vocoder_sync — extract strings and submit for translation.
server.tool(
	"vocoder_sync",
	"Extract all translatable strings from the current app and submit them to Vocoder for translation. Polls until translations are ready (up to 60 seconds).",
	{
		branch: z
			.string()
			.optional()
			.describe("Git branch to sync (auto-detected from git if not provided)"),
		force: z
			.boolean()
			.optional()
			.describe("Force re-sync even if strings are unchanged"),
		mode: z
			.enum(["auto", "required", "best-effort"])
			.optional()
			.describe(
				'Sync mode: "auto" (default), "required" (block until done), "best-effort" (queue and return immediately)',
			),
	},
	async ({ branch, force, mode }) => {
		const client = createClient();
		if (!client)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runSync({ branch, force, mode }, client);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Sync failed: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	},
);

// vocoder_get_translations — fetch the current translation snapshot.
server.tool(
	"vocoder_get_translations",
	"Fetch the current translation snapshot for a branch. Returns a JSON map of { locale: { sourceText: translatedText } }.",
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
		const client = createClient();
		if (!client)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runGetTranslations({ branch, locale }, client);
			return { content: [{ type: "text", text }] };
		} catch (error) {
			return {
				content: [
					{
						type: "text",
						text: `Failed to fetch translations: ${error instanceof Error ? error.message : String(error)}`,
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
		const client = createClient();
		if (!client)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const { locales } = await client.listLocales();
			const lines = locales.map((l) =>
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
		const client = createClient();
		if (!client)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runAddLocale(locale, client);
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
	'Remove a target locale from the Vocoder app. Pass the BCP 47 code of a currently-configured target locale (e.g. "fr", "de"). Use vocoder_status to see the current target locales before calling.',
	{
		locale: z
			.string()
			.describe('BCP 47 locale code to remove, e.g. "fr" or "pt-BR"'),
	},
	async ({ locale }) => {
		const client = createClient();
		if (!client)
			return { content: [{ type: "text", text: NO_API_KEY_MESSAGE }] };
		try {
			const text = await runRemoveLocale(locale, client);
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
