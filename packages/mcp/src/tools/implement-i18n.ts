import {
	buildInstallCommand,
	detectLocalEcosystem,
	getPackagesToInstall,
	getSetupSnippets,
} from "@vocoder/cli/lib";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface ImplementI18nInput {
	sourceLocale?: string;
	targetLocales?: string[];
	scope?: string;
	appDir?: string;
}

export interface ImplementI18nResult {
	detectedFramework: string | null;
	detectedEcosystem: string | null;
	phase1_install: {
		devInstallCommand: string | null;
		runtimeInstallCommand: string | null;
		configFile: { path: string; content: string };
	};
	phase2_plugin: {
		file: string;
		fileExists: boolean;
		action: "create" | "modify";
		code: string;
		mergeNote: string | null;
	} | null;
	phase3_provider: {
		file: string;
		fileExists: boolean;
		action: "create" | "modify";
		importToAdd: string;
		wrapInstruction: string;
		fullCode: string | null;
		ssrNote: string | null;
	};
	phase4_wrapping: {
		importStatement: string;
		filesToScan: string[];
		patternsToFind: Array<{ pattern: string; example: string }>;
		patternsToSkip: string[];
		tFunctionUsage: string;
	};
	phase5_localeSelector: {
		recommendation: string;
		builtIn: { importStatement: string; usage: string };
		custom: { importStatement: string; usage: string };
	};
	quickReference: {
		componentVsFunction: string;
		variables: { rule: string; correct: string; wrong: string };
		plurals: { rule: string; correct: string; wrong: string };
		richText: { rule: string; correct: string };
		extractorBailCases: string[];
		afterWrapping: string;
	};
	sdkReferenceUri: string;
	steps: string[];
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".next",
	".nuxt",
	"out",
	".cache",
	"coverage",
	".turbo",
]);

const SOURCE_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js"]);

const TEST_PATTERNS = [
	".test.",
	".spec.",
	"__tests__",
	"__mocks__",
	"cypress",
	"playwright",
	"e2e",
];

function scanSourceFiles(root: string, baseDir: string, results: string[]): void {
	if (results.length >= 100) return;
	let entries: string[];
	try {
		entries = readdirSync(root);
	} catch {
		return;
	}
	for (const entry of entries) {
		if (results.length >= 100) return;
		const full = join(root, entry);
		let stat: ReturnType<typeof statSync> | undefined;
		try {
			stat = statSync(full);
		} catch {
			continue;
		}
		if (stat.isDirectory()) {
			if (!SKIP_DIRS.has(entry)) scanSourceFiles(full, baseDir, results);
		} else {
			const dot = entry.lastIndexOf(".");
			if (dot === -1) continue;
			const ext = entry.slice(dot);
			if (!SOURCE_EXTENSIONS.has(ext)) continue;
			const rel = relative(baseDir, full);
			if (TEST_PATTERNS.some((p) => rel.includes(p))) continue;
			results.push(rel);
		}
	}
}

function resolveProviderFile(
	cwd: string,
	framework: string | null,
	ecosystem: string | null,
): { file: string; ssrNote: string | null } {
	if (framework === "nextjs") {
		const appDir = join(cwd, "app");
		const hasAppRouter = existsSync(appDir);
		if (hasAppRouter) {
			const candidates = ["app/layout.tsx", "app/layout.jsx", "app/layout.js"];
			const found = candidates.find((c) => existsSync(join(cwd, c)));
			return {
				file: found ?? "app/layout.tsx",
				ssrNote:
					"Next.js App Router: layout.tsx is a Server Component — it reads the vocoder_locale and vocoder_preview cookies and passes initialLocale and preview props to VocoderProvider. Import getLocaleDir from '@vocoder/react/server' and getConfig/getLocales from '@vocoder/react' to set lang and dir on <html> server-side for correct RTL on first paint. See fullCode for the complete pattern.",
			};
		}
		const pagesCandidates = [
			"pages/_app.tsx",
			"pages/_app.jsx",
			"pages/_app.js",
		];
		const pagesFound = pagesCandidates.find((c) => existsSync(join(cwd, c)));
		return { file: pagesFound ?? "pages/_app.tsx", ssrNote: null };
	}

	if (framework === "remix") {
		const candidates = ["app/root.tsx", "app/root.jsx"];
		const found = candidates.find((c) => existsSync(join(cwd, c)));
		return { file: found ?? "app/root.tsx", ssrNote: null };
	}

	if (ecosystem === "react") {
		const candidates = [
			"src/main.tsx",
			"src/main.ts",
			"src/main.jsx",
			"src/index.tsx",
			"src/App.tsx",
		];
		const found = candidates.find((c) => existsSync(join(cwd, c)));
		return { file: found ?? "src/main.tsx", ssrNote: null };
	}

	return { file: "src/main.tsx", ssrNote: null };
}

function buildNextAppRouterLayoutCode(): string {
	return `import { cookies } from 'next/headers';
import { getConfig, getLocales, VocoderProvider } from '@vocoder/react';
import { getLocaleDir } from '@vocoder/react/server';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const initialLocale = cookieStore.get('vocoder_locale')?.value;
  const preview = cookieStore.get('vocoder_preview')?.value === 'true';
  const { sourceLocale } = getConfig();
  const locale = initialLocale ?? sourceLocale;
  const dir = getLocaleDir(locale, getLocales());

  return (
    <html lang={locale} dir={dir}>
      <body>
        <VocoderProvider initialLocale={initialLocale} preview={preview}>
          {children}
        </VocoderProvider>
      </body>
    </html>
  );
}`;
}

export function runImplementI18n(input: ImplementI18nInput): ImplementI18nResult {
	const sourceLocale = input.sourceLocale ?? "en";
	const _targetLocales = input.targetLocales ?? [];
	const cwd = input.appDir ?? process.cwd();
	const scanRoot = input.scope ? join(cwd, input.scope) : cwd;

	const detection = detectLocalEcosystem(cwd);
	const { devPackages, runtimePackages } = getPackagesToInstall(detection);

	const devInstallCommand =
		devPackages.length > 0
			? buildInstallCommand(detection.packageManager, devPackages, true)
			: null;
	const runtimeInstallCommand =
		runtimePackages.length > 0
			? buildInstallCommand(detection.packageManager, runtimePackages)
			: null;

	const localesDir = "src/locales";
	const configContent = [
		"import { defineConfig } from '@vocoder/config';",
		"",
		"export default defineConfig({",
		`  localesDir: '${localesDir}',`,
		"});",
	].join("\n");

	const snippets = getSetupSnippets({
		framework: detection.framework,
		ecosystem: detection.ecosystem,
		sourceLocale,
		targetBranches: ["main"],
	});

	const phase2_plugin = snippets.pluginStep
		? {
				file: snippets.pluginStep.file,
				fileExists: existsSync(join(cwd, snippets.pluginStep.file)),
				action: existsSync(join(cwd, snippets.pluginStep.file))
					? ("modify" as const)
					: ("create" as const),
				code: snippets.pluginStep.code,
				mergeNote: existsSync(join(cwd, snippets.pluginStep.file))
					? `File already exists. Merge the Vocoder plugin into your existing ${snippets.pluginStep.file} — do not overwrite the whole file.`
					: null,
			}
		: null;

	const { file: providerFile, ssrNote } = resolveProviderFile(
		cwd,
		detection.framework,
		detection.ecosystem,
	);

	const providerFileExists = existsSync(join(cwd, providerFile));

	let providerFullCode: string | null = null;
	let wrapInstruction =
		"Add VocoderProvider wrapping your root children. Import from '@vocoder/react'.";

	if (detection.framework === "nextjs") {
		if (!providerFileExists) {
			providerFullCode = buildNextAppRouterLayoutCode();
			wrapInstruction =
				"Create app/layout.tsx using the fullCode — it reads vocoder_locale and vocoder_preview cookies and passes initialLocale and preview to VocoderProvider. Also sets lang and dir on <html> using getLocaleDir for correct RTL server-side rendering.";
		} else {
			wrapInstruction =
				`In ${providerFile}, read the vocoder_locale and vocoder_preview cookies with \`(await cookies()).get('vocoder_locale')?.value\`, then pass initialLocale and preview props to VocoderProvider. Import getLocaleDir from '@vocoder/react/server' and getConfig/getLocales from '@vocoder/react' to set lang and dir on <html>. See vocoder://docs/framework-setup for the complete pattern.`;
		}
	} else if (providerFileExists) {
		wrapInstruction = `In ${providerFile}, wrap your root children with <VocoderProvider>. Import from '@vocoder/react'.`;
	}

	const filesFound: string[] = [];
	scanSourceFiles(scanRoot, cwd, filesFound);
	filesFound.sort((a, b) => {
		const depthA = a.split("/").length;
		const depthB = b.split("/").length;
		return depthA !== depthB ? depthA - depthB : a.localeCompare(b);
	});

	const steps: string[] = [
		devInstallCommand || runtimeInstallCommand
			? `Step 1: Install packages — ${[devInstallCommand, runtimeInstallCommand].filter(Boolean).join(" && ")}`
			: "Step 1: All Vocoder packages already installed",
		`Step 2: Create vocoder.config.ts at the project root`,
		phase2_plugin
			? `Step 3: ${phase2_plugin.action === "modify" ? "Update" : "Create"} ${phase2_plugin.file} with Vocoder build plugin`
			: "Step 3: (No build plugin needed for this framework)",
		`Step 4: ${providerFileExists ? "Update" : "Create"} ${providerFile} to add VocoderProvider`,
		`Step 5: Wrap all visible UI strings in ${filesFound.length} source files with <T> or t()`,
		"Step 6: Add a locale switcher — use <LocaleSelector /> for a zero-config floating button, or build custom with useVocoder() if you need it embedded in your nav/header",
		"Step 7: Push to a target branch — the GitHub Actions workflow extracts strings and submits them for translation automatically. To test locally before pushing, run `npx @vocoder/cli translate`.",
	];

	return {
		detectedFramework: detection.framework,
		detectedEcosystem: detection.ecosystem,
		phase1_install: {
			devInstallCommand,
			runtimeInstallCommand,
			configFile: { path: "vocoder.config.ts", content: configContent },
		},
		phase2_plugin,
		phase3_provider: {
			file: providerFile,
			fileExists: providerFileExists,
			action: providerFileExists ? "modify" : "create",
			importToAdd: "import { VocoderProvider } from '@vocoder/react';",
			wrapInstruction,
			fullCode: providerFullCode,
			ssrNote,
		},
		phase4_wrapping: {
			importStatement: "import { T, t } from '@vocoder/react';",
			filesToScan: filesFound,
			patternsToFind: [
				{
					pattern: "JSX text content — visible string literals inside elements",
					example:
						"Before: <p>Hello, world!</p>  After: <p><T>Hello, world!</T></p>",
				},
				{
					pattern: "JSX string attributes — title, placeholder, aria-label, alt",
					example:
						"Before: <input placeholder=\"Search...\" />  After: <input placeholder={t('Search...')} />",
				},
				{
					pattern: "Button and link labels",
					example: "Before: <button>Save changes</button>  After: <button><T>Save changes</T></button>",
				},
				{
					pattern: "Toast / alert / notification messages",
					example: "Before: toast('File saved')  After: toast(t('File saved'))",
				},
				{
					pattern: "Heading and section labels",
					example: "Before: <h1>Dashboard</h1>  After: <h1><T>Dashboard</T></h1>",
				},
			],
			patternsToSkip: [
				"import/require paths and module specifiers",
				"URL strings and href attributes",
				"CSS class names and Tailwind classes",
				"console.log, console.error, and other debug statements",
				"Test files (*.test.*, *.spec.*, __tests__/)",
				"Already-dynamic JSX expressions: {someVariable}",
				"Type assertions, type imports, and TypeScript-only constructs",
				"data-* attributes and technical HTML attributes (id, name, type)",
				"Environment variable references and config strings",
				"Short single-word strings that are variable names or IDs",
			],
			tFunctionUsage:
				"Use t() (not <T>) for: non-JSX contexts, strings passed as function arguments (toast, alert, console), aria-label/title/placeholder attributes, window.document.title. Example: document.title = t('Settings | MyApp')",
		},
		phase5_localeSelector: {
			recommendation:
				"Add a locale switcher so users can change language. Use <LocaleSelector /> for a zero-config floating button (good for prototypes, internal tools, or any UI where a floating widget fits). Build custom with useVocoder() when you need it embedded in a nav/header, want to match an existing design system, or want to avoid the Radix UI bundle (~40KB gzip) that LocaleSelector includes.",
			builtIn: {
				importStatement: "import { LocaleSelector } from '@vocoder/react/locale-selector'",
				usage: "<LocaleSelector />  {/* floating button, bottom-right by default */}",
			},
			custom: {
				importStatement: "import { useVocoder } from '@vocoder/react'",
				usage:
					"const { locale, setLocale, availableLocales, locales } = useVocoder()\n" +
					"<select value={locale} onChange={e => setLocale(e.target.value)}>\n" +
					"  {availableLocales.map(loc => (\n" +
					"    <option key={loc} value={loc}>{locales?.[loc]?.nativeName ?? loc}</option>\n" +
					"  ))}\n" +
					"</select>",
			},
		},
		quickReference: {
			componentVsFunction:
				"Use <T> for JSX text content. Use t() for everything else: string attributes (placeholder, aria-label, title, alt), callback arguments (toast, alert), document.title, non-JSX modules. Both are imported from '@vocoder/react'. t() from useVocoder() is reactive (re-runs on locale change); module-level t() is not reactive but safe for use outside components.",
			variables: {
				rule: "The build plugin handles natural JSX variable interpolation automatically — write <T>Hello {name}!</T> and the plugin transforms it. Bail cases are: template literals, ternary expressions, logical &&, or a lone variable as the only child with no surrounding text.",
				correct: "<T>Hello {name}, you have {count} messages</T>  // plugin transforms to message prop + values automatically",
				wrong: "<T>{`Hello ${name}`}</T>  // template literal — bail. Use: <T message=\"Hello {name}!\" values={{ name }} />",
			},
			plurals: {
				rule: "Use <T> plural props (one/other/few/many) for count-based strings. Never use ternaries or if-statements to switch between plural forms.",
				correct: "<T value={count} one=\"# item\" other=\"# items\" />",
				wrong: "<T>{count === 1 ? '1 item' : `${count} items`}</T>  // not translatable as a unit",
			},
			richText: {
				rule: "For JSX with inline elements (links, bold, etc.), use natural JSX syntax — the plugin transforms it. Do not manually split the string.",
				correct: "<T>Read <a href=\"/docs\">the docs</a> for help.</T>  // plugin extracts as: 'Read <0>the docs</0> for help.'",
			},
			extractorBailCases: [
				"Dynamic children: <T>{someVariable}</T> — use message prop + values instead",
				"String concatenation: <T>{'Hello ' + name}</T> — use message prop + values instead",
				"Spread props on <T> — all props must be static literals",
				"<T> inside another <T> — flatten to a single <T> with components prop",
				"Ternary as direct child: <T>{flag ? 'A' : 'B'}</T> — use _case props or separate <T> per branch",
				"Template literals as children: <T>{`Hello ${name}`}</T> — use message prop + values instead",
			],
			afterWrapping:
				"After wrapping all strings, push to a target branch. The GitHub Actions workflow automatically extracts all <T> and t() calls, submits them for translation, and updates the translation bundle before your build runs. To test locally before pushing, run `npx @vocoder/cli translate`.",
		},
		sdkReferenceUri: "vocoder://docs/sdk-reference",
		steps,
	};
}
