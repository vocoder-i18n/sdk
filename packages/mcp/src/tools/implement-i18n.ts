import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
	buildInstallCommand,
	detectLocalEcosystem,
	getPackagesToInstall,
	getSetupSnippets,
} from "@vocoder/cli/lib";

export interface ImplementI18nInput {
	sourceLocale?: string;
	targetLocales?: string[];
	scope?: string;
	appDir?: string;
}

export interface ImplementI18nResult {
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
		let stat;
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
					"Next.js App Router: VocoderProvider must be in a Client Component. Create app/providers.tsx with 'use client' that wraps VocoderProvider. In app/layout.tsx (Server Component), import cookies from 'next/headers' and pass (await cookies()).toString() to the provider. See fullCode for the complete pattern.",
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

function buildNextAppRouterProviderCode(sourceLocale: string): {
	layoutCode: string;
	providersCode: string;
} {
	const layoutCode = `import { cookies } from 'next/headers';
import Providers from './providers';

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  return (
    <html>
      <body>
        <Providers cookies={cookieStore.toString()}>
          {children}
        </Providers>
      </body>
    </html>
  );
}`;

	const providersCode = `'use client';

import { VocoderProvider } from '@vocoder/react';

export default function Providers({
  children,
  cookies,
}: {
  children: React.ReactNode;
  cookies: string;
}) {
  return (
    <VocoderProvider cookies={cookies}>
      {children}
    </VocoderProvider>
  );
}`;

	return { layoutCode, providersCode };
}

export function runImplementI18n(input: ImplementI18nInput): ImplementI18nResult {
	const sourceLocale = input.sourceLocale ?? "en";
	const targetLocales = input.targetLocales ?? [];
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

	const localesPath = "src/locales";
	const configContent = [
		"import { defineConfig } from '@vocoder/config';",
		"",
		"export default defineConfig({",
		`  localesPath: '${localesPath}',`,
		...(targetLocales.length > 0
			? []
			: ["  // targetBranches: ['main'],  // branches that trigger translation"]),
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

	if (detection.framework === "nextjs" && !providerFileExists) {
		const { layoutCode } = buildNextAppRouterProviderCode(sourceLocale);
		providerFullCode = layoutCode;
		wrapInstruction =
			"Create app/providers.tsx as a 'use client' component wrapping VocoderProvider. Update app/layout.tsx to pass cookies from next/headers to Providers. See fullCode for the layout.tsx pattern; you also need to create app/providers.tsx separately.";
	} else if (providerFileExists) {
		wrapInstruction = `In ${providerFile}, wrap your root children with <VocoderProvider>. For SSR, pass cookies from request headers.`;
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
		"Step 6: Run vocoder_sync to extract strings and submit for translation",
	];

	return {
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
		sdkReferenceUri: "vocoder://docs/sdk-reference",
		steps,
	};
}
