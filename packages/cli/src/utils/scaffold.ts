/**
 * @module scaffold
 *
 * Post-project-creation scaffolding: package installation, config file writing,
 * and getting-started output. Runs after the project and app records exist in
 * the API so failures here do not block the user's project from being created.
 *
 * Exports: runScaffold, writeAppConfigs
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import {
	buildInstallCommand,
	detectLocalEcosystem,
	getPackagesToInstall,
} from "./detect-local.js";
import { highlight, info } from "./theme.js";
import { findExistingConfig, writeVocoderConfig } from "./write-config.js";

export interface ScaffoldParams {
	targetBranches: string[];
}

/**
 * Detects the local ecosystem, installs missing packages, and prints push
 * instructions + docs link. Called after project creation in both new-project
 * and add-app paths.
 */
export function runScaffold(params: ScaffoldParams): void {
	const { targetBranches } = params;

	const detection = detectLocalEcosystem();

	if (detection.ecosystem) {
		const frameworkLabel = detection.framework ?? detection.ecosystem;
		const pmLabel = detection.packageManager;
		p.log.info(`Detected:  ${chalk.bold(frameworkLabel)} (${pmLabel})`);
	}

	const { devPackages, runtimePackages } = getPackagesToInstall(detection);
	const allPackages = [...devPackages, ...runtimePackages];
	if (allPackages.length > 0) {
		p.log.info("");
		const installSpinner = p.spinner();
		installSpinner.start(`Installing ${allPackages.join(", ")}...`);

		try {
			if (devPackages.length > 0) {
				execSync(
					buildInstallCommand(detection.packageManager, devPackages, true),
					{ stdio: "pipe", cwd: process.cwd() },
				);
			}
			if (runtimePackages.length > 0) {
				execSync(
					buildInstallCommand(detection.packageManager, runtimePackages, false),
					{ stdio: "pipe", cwd: process.cwd() },
				);
			}
			installSpinner.stop(`Installed ${allPackages.join(", ")}`);
		} catch {
			installSpinner.stop("Package installation failed");
			const cmds = [
				devPackages.length > 0
					? buildInstallCommand(detection.packageManager, devPackages, true)
					: null,
				runtimePackages.length > 0
					? buildInstallCommand(detection.packageManager, runtimePackages, false)
					: null,
			]
				.filter(Boolean)
				.join(" && ");
			p.log.warn(`Run manually: ${highlight(cmds)}`);
		}
	} else if (detection.ecosystem) {
		p.log.info(`Packages:  ${chalk.green("already installed")}`);
	}

	const branchList =
		targetBranches.length > 0
			? targetBranches.map((b) => highlight(b)).join(" or ")
			: highlight("your target branch");
	p.log.message("");
	p.log.success(`Push to ${branchList} to trigger your first translation run.`);
	p.log.message(info("  Docs: https://vocoder.app/docs/getting-started"));
}

/**
 * Writes one vocoder.config.ts (or .js) per app directory and logs the result.
 * Non-monorepo projects write a single config at the project root.
 */
export function writeAppConfigs(
	apps: Array<{ appDir: string; appId: string }>,
	targetBranches: string[],
	useTypeScript: boolean,
	repoRoot?: string,
): void {
	const base = repoRoot ?? process.cwd();
	for (const app of apps) {
		const dir = app.appDir ? resolve(base, app.appDir) : base;
		const written = writeVocoderConfig({
			targetBranches,
			appId: app.appId,
			cwd: dir,
			useTypeScript,
		});
		if (written) {
			const displayPath = app.appDir ? `${app.appDir}/${written}` : written;
			p.log.success(`Created ${highlight(displayPath)}`);
		} else if (!findExistingConfig(dir)) {
			const ext = useTypeScript ? "ts" : "js";
			p.log.warn(
				`Could not write ${app.appDir ? `${app.appDir}/` : ""}vocoder.config.${ext} — create it manually.`,
			);
		}
	}
}
