import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { CommandSession, formatLabelValue } from "./command-session.js";
import {
	buildInstallCommand,
	detectLocalEcosystem,
} from "./detect-local.js";
import { highlight } from "./theme.js";

const execAsync = promisify(exec);

async function runInstall(
	session: CommandSession,
	command: string,
	cwd: string,
	label: string,
): Promise<boolean> {
	const step = session.startStep(`Installing packages in ${label}`);
	try {
		await execAsync(command, { cwd });
		step.done(`Installed packages in ${highlight(label)}`);
		return true;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		step.done(`Install skipped in ${highlight(label)}`);
		session.warn(`Could not install packages in ${highlight(label)}.`);
		session.info(formatLabelValue("Command", highlight(command)));
		session.info(msg);
		return false;
	}
}

/**
 * Install Vocoder packages after project creation.
 *
 * Root project: everything (cli, plugin, config, ui package) installs at rootDir.
 * Monorepo: cli installs at rootDir; plugin, config, and ui package install per appDir.
 * Package manager is detected from the rootDir lockfile in both cases.
 */
export async function installForProject({
	rootDir,
	appDirs,
	installMcp,
	session,
}: {
	rootDir: string;
	appDirs: string[];
	installMcp: boolean;
	session: CommandSession;
}): Promise<void> {
	const isMonorepo = appDirs.length > 0;
	const rootDetection = detectLocalEcosystem(rootDir);
	const pm = rootDetection.packageManager;

	if (isMonorepo) {
		// CLI (and optionally MCP) at monorepo root
		const rootDevPkgs: string[] = [];
		if (!rootDetection.hasCli) rootDevPkgs.push("@vocoder/cli");
		if (installMcp) rootDevPkgs.push("@vocoder/mcp");

			if (rootDevPkgs.length > 0) {
				const cmd = buildInstallCommand(pm, rootDevPkgs, true);
				await runInstall(session, cmd, rootDir, "root");
			}

		// Per-app: plugin, config, ui package
			for (const appDir of appDirs) {
				const appDirFull = join(rootDir, appDir);
				if (!existsSync(join(appDirFull, "package.json"))) {
					session.warn(
						`No package.json found in ${highlight(appDir)} — skipping install.`,
					);
					continue;
				}

			const detection = detectLocalEcosystem(appDirFull);
			const devPkgs: string[] = [];
			const runtimePkgs: string[] = [];

			if (!detection.hasUnplugin) devPkgs.push("@vocoder/plugin");
			if (!detection.hasConfig) devPkgs.push("@vocoder/config");
			if (detection.uiPackage && !detection.hasUiPackage) runtimePkgs.push(detection.uiPackage);

				if (detection.uiPackage === null) {
					session.warn(
						`Could not detect a UI framework in ${highlight(appDir)}.`,
					);
					session.info("Install @vocoder/react (or vue/svelte) manually.");
				}

				if (devPkgs.length > 0) {
					await runInstall(
						session,
						buildInstallCommand(pm, devPkgs, true),
						appDirFull,
						appDir,
					);
				}
				if (runtimePkgs.length > 0) {
					await runInstall(
						session,
						buildInstallCommand(pm, runtimePkgs, false),
						appDirFull,
						appDir,
					);
				}
			}
	} else {
		// Root project — install everything at rootDir
		const devPkgs: string[] = [];
		const runtimePkgs: string[] = [];

		if (!rootDetection.hasCli) devPkgs.push("@vocoder/cli");
		if (!rootDetection.hasUnplugin) devPkgs.push("@vocoder/plugin");
		if (!rootDetection.hasConfig) devPkgs.push("@vocoder/config");
		if (installMcp) devPkgs.push("@vocoder/mcp");
		if (rootDetection.uiPackage && !rootDetection.hasUiPackage) {
			runtimePkgs.push(rootDetection.uiPackage);
		}

			if (rootDetection.uiPackage === null) {
				session.warn("Could not detect a UI framework.");
				session.info("Install @vocoder/react (or vue/svelte) manually.");
			}

			if (devPkgs.length > 0) {
				await runInstall(
					session,
					buildInstallCommand(pm, devPkgs, true),
					rootDir,
					"root",
				);
			}
			if (runtimePkgs.length > 0) {
				await runInstall(
					session,
					buildInstallCommand(pm, runtimePkgs, false),
					rootDir,
					"root",
				);
			}
		}
}
