import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	buildInstallCommand,
	detectLocalEcosystem,
	getPackagesToInstall,
	getSetupSnippets,
} from "@vocoder/cli/lib";

export interface SetupInput {
	sourceLocale?: string;
	targetLocales?: string[];
}

export interface SetupResult {
	framework: string | null;
	ecosystem: string | null;
	packagesAlreadyInstalled: boolean;
	devInstallCommand: string | null;
	runtimeInstallCommand: string | null;
	pluginFile: string | null;
	pluginCode: string | null;
	providerFile: string | null;
	providerCode: string | null;
	wrapExample: string;
	authStatus: "configured" | "missing";
	authInstructions: string | null;
	wrapping: {
		importStatement: string;
		patternsToWrap: string[];
		patternsToSkip: string[];
	};
	sdkReferenceUri: string;
	nextSteps: string[];
}

function resolveProviderFile(
	cwd: string,
	framework: string | null,
	ecosystem: string | null,
): string | null {
	if (framework === "nextjs") {
		if (existsSync(join(cwd, "app"))) {
			const candidates = ["app/layout.tsx", "app/layout.jsx", "app/layout.js"];
			return candidates.find((c) => existsSync(join(cwd, c))) ?? "app/layout.tsx";
		}
		const candidates = ["pages/_app.tsx", "pages/_app.jsx", "pages/_app.js"];
		return candidates.find((c) => existsSync(join(cwd, c))) ?? "pages/_app.tsx";
	}

	if (framework === "remix") {
		const candidates = ["app/root.tsx", "app/root.jsx"];
		return candidates.find((c) => existsSync(join(cwd, c))) ?? "app/root.tsx";
	}

	if (ecosystem === "react") {
		const candidates = [
			"src/main.tsx",
			"src/main.ts",
			"src/main.jsx",
			"src/index.tsx",
		];
		return candidates.find((c) => existsSync(join(cwd, c))) ?? "src/App.tsx";
	}

	return null;
}

export function runSetup(input: SetupInput, hasApiKey: boolean): SetupResult {
	const sourceLocale = input.sourceLocale ?? "en";
	const cwd = process.cwd();

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

	const snippets = getSetupSnippets({
		framework: detection.framework,
		ecosystem: detection.ecosystem,
		sourceLocale,
		targetBranches: ["main"],
	});

	const resolvedProviderFile = resolveProviderFile(
		cwd,
		detection.framework,
		detection.ecosystem,
	);

	const nextSteps: string[] = [];
	if (devInstallCommand || runtimeInstallCommand) {
		nextSteps.push(
			`Install packages: ${[devInstallCommand, runtimeInstallCommand].filter(Boolean).join(" && ")}`,
		);
	}
	if (snippets.pluginStep) {
		nextSteps.push(
			`Configure build plugin in ${snippets.pluginStep.file}`,
		);
	}
	if (resolvedProviderFile) {
		nextSteps.push(`Add VocoderProvider in ${resolvedProviderFile}`);
	}
	nextSteps.push("Wrap translatable strings with <T> and t()");
	nextSteps.push(snippets.whatsNext);
	if (!hasApiKey) {
		nextSteps.push(
			"Run `npx @vocoder/cli init` to connect this project and get your API key",
		);
	}

	return {
		framework: detection.framework,
		ecosystem: detection.ecosystem,
		packagesAlreadyInstalled:
			devPackages.length === 0 && runtimePackages.length === 0,
		devInstallCommand,
		runtimeInstallCommand,
		pluginFile: snippets.pluginStep?.file ?? null,
		pluginCode: snippets.pluginStep?.code ?? null,
		providerFile: resolvedProviderFile ?? snippets.providerStep?.file ?? null,
		providerCode: snippets.providerStep?.code ?? null,
		wrapExample: snippets.wrapStep.code,
		authStatus: hasApiKey ? "configured" : "missing",
		authInstructions: hasApiKey
			? null
			: [
					"1. Run in your terminal: npx @vocoder/cli init",
					"2. Browser opens — install the Vocoder GitHub App and authenticate",
					"3. Copy the VOCODER_API_KEY shown in your terminal",
					"4. Add to your MCP config: VOCODER_API_KEY=<your-key>",
					"5. Restart your MCP server / reload the editor session",
				].join("\n"),
		wrapping: {
			importStatement: "import { T, t } from '@vocoder/react';",
			patternsToWrap: [
				"JSX text content — visible string literals inside elements: <p>text</p>",
				"title= attributes",
				"placeholder= attributes",
				"aria-label= attributes",
				"alt= attributes on images",
				"toast() / notification() / alert() message arguments",
				"Button and link labels",
				"Heading text (h1–h6)",
				"Navigation menu items",
				"Form labels and error messages",
			],
			patternsToSkip: [
				"import/require paths and module specifiers",
				"URL strings and href/src attributes",
				"CSS class names and Tailwind utility classes",
				"console.log and debug statements",
				"Test files (*.test.*, *.spec.*, __tests__/)",
				"Already-dynamic JSX expressions: {someVariable}",
				"data-* attributes and technical HTML attributes (id, name, type, key)",
				"Environment variable references",
				"Single-word strings that are identifiers or enum values",
			],
		},
		sdkReferenceUri: "vocoder://docs/sdk-reference",
		nextSteps,
	};
}
