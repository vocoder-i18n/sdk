import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export type DetectedFramework =
	| "nextjs"
	| "vite"
	| "remix"
	| "nuxt"
	| "sveltekit"
	| "gatsby"
	| "angular"
	| null;

export type DetectedEcosystem = "react" | "vue" | "svelte" | "angular" | null;

export interface LocalDetectionResult {
	ecosystem: DetectedEcosystem;
	framework: DetectedFramework;
	packageManager: PackageManager;
	uiPackage: string | null;
	hasCli: boolean;
	hasUnplugin: boolean;
	hasExtractor: boolean;
	hasConfig: boolean;
	hasUiPackage: boolean;
	sourceLocale: string | null;
	/** True when a tsconfig.json is present or TypeScript is listed as a dependency. */
	isTypeScript: boolean;
}

/**
 * Detect the local project's ecosystem, framework, and package manager
 * by inspecting filesystem artifacts. No network calls.
 */
export function detectLocalEcosystem(
	cwd: string = process.cwd(),
): LocalDetectionResult {
	const packageManager = detectPackageManager(cwd);
	const pkg = readPackageJson(cwd);

	if (!pkg) {
		return {
			ecosystem: null,
			framework: null,
			packageManager,
			uiPackage: null,
			hasCli: false,
			hasUnplugin: false,
			hasExtractor: false,
			hasConfig: false,
			hasUiPackage: false,
			sourceLocale: null,
			isTypeScript: existsSync(join(cwd, "tsconfig.json")),
		};
	}

	const allDeps = {
		...((pkg.dependencies as Record<string, string>) ?? {}),
		...((pkg.devDependencies as Record<string, string>) ?? {}),
	};

	const hasCli = "@vocoder/cli" in allDeps;
	const hasUnplugin = "@vocoder/plugin" in allDeps;
	const hasExtractor = "@vocoder/extractor" in allDeps;
	const hasConfig = "@vocoder/config" in allDeps;
	const isTypeScript =
		existsSync(join(cwd, "tsconfig.json")) || "typescript" in allDeps;

	// Detect ecosystem + framework
	const { ecosystem, framework, uiPackage } = detectFromDeps(allDeps, cwd);
	const hasUiPackage = uiPackage !== null && uiPackage in allDeps;

	return {
		ecosystem,
		framework,
		packageManager,
		uiPackage,
		hasCli,
		hasUnplugin,
		hasExtractor,
		hasConfig,
		hasUiPackage,
		sourceLocale: null,
		isTypeScript,
	};
}

function detectPackageManager(cwd: string): PackageManager {
	if (existsSync(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (existsSync(join(cwd, "bun.lockb")) || existsSync(join(cwd, "bun.lock")))
		return "bun";
	if (existsSync(join(cwd, "yarn.lock"))) return "yarn";
	return "npm";
}

function readPackageJson(cwd: string): Record<string, unknown> | null {
	const pkgPath = join(cwd, "package.json");
	if (!existsSync(pkgPath)) return null;
	try {
		return JSON.parse(readFileSync(pkgPath, "utf-8")) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}
}

function detectFromDeps(
	allDeps: Record<string, string>,
	cwd: string,
): {
	ecosystem: DetectedEcosystem;
	framework: DetectedFramework;
	uiPackage: string | null;
} {
	// Vue ecosystem
	if ("vue" in allDeps) {
		const framework = "nuxt" in allDeps ? ("nuxt" as const) : null;
		return { ecosystem: "vue", framework, uiPackage: "@vocoder/vue" };
	}

	// Svelte ecosystem
	if ("svelte" in allDeps) {
		const framework =
			"@sveltejs/kit" in allDeps ? ("sveltekit" as const) : null;
		return { ecosystem: "svelte", framework, uiPackage: "@vocoder/svelte" };
	}

	// Angular ecosystem
	if ("@angular/core" in allDeps || existsSync(join(cwd, "angular.json"))) {
		return {
			ecosystem: "angular",
			framework: "angular",
			uiPackage: "@vocoder/angular",
		};
	}

	// React ecosystem (most common — check last)
	if ("react" in allDeps) {
		let framework: DetectedFramework = null;
		if ("next" in allDeps) framework = "nextjs";
		else if ("@remix-run/react" in allDeps) framework = "remix";
		else if ("gatsby" in allDeps) framework = "gatsby";
		else if ("vite" in allDeps) framework = "vite";
		return { ecosystem: "react", framework, uiPackage: "@vocoder/react" };
	}

	return { ecosystem: null, framework: null, uiPackage: null };
}

/**
 * Build the install command for packages that aren't already installed.
 * Pass dev=true for devDependencies (-D flag).
 */
export function buildInstallCommand(
	packageManager: PackageManager,
	packages: string[],
	dev = false,
): string {
	if (packages.length === 0) return "";
	const pkgList = packages.join(" ");
	const devFlag = dev ? " -D" : "";
	switch (packageManager) {
		case "pnpm":
			return `pnpm add${devFlag} ${pkgList}`;
		case "yarn":
			return `yarn add${devFlag} ${pkgList}`;
		case "bun":
			return `bun add${devFlag} ${pkgList}`;
		default:
			return `npm install${devFlag} ${pkgList}`;
	}
}

/**
 * Get the lists of packages that need to be installed, split by dep type.
 * devPackages → devDependencies (build tools)
 * runtimePackages → dependencies (used at runtime in the app)
 */
export function getPackagesToInstall(detection: LocalDetectionResult): {
	devPackages: string[];
	runtimePackages: string[];
} {
	const devPackages: string[] = [];
	const runtimePackages: string[] = [];

	if (!detection.hasCli) devPackages.push("@vocoder/cli");
	if (!detection.hasUnplugin) devPackages.push("@vocoder/plugin");
	if (!detection.hasConfig) devPackages.push("@vocoder/config");

	if (detection.uiPackage && !detection.hasUiPackage)
		runtimePackages.push(detection.uiPackage);

	return { devPackages, runtimePackages };
}
