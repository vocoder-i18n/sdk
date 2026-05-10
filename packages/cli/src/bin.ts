#!/usr/bin/env node

import { Command } from "commander";
import { init } from "./commands/init.js";
import {
	addLocales,
	listProjectLocales,
	listSupportedLocales,
	removeLocales,
} from "./commands/locales.js";
import { logout } from "./commands/logout.js";
import { appConfig } from "./commands/app-config.js";
import { sync } from "./commands/sync.js";
import { getTranslations } from "./commands/translations.js";
import { createApp } from "./commands/create-app.js";
import { regenerateKey } from "./commands/regenerate-key.js";
import { whoami } from "./commands/whoami.js";

/**
 * Collector function for repeated CLI options
 * Allows multiple --include or --exclude flags
 */
function collect(value: string, previous: string[] = []): string[] {
	return previous.concat([value]);
}

async function runCommand(
	command: (options: any) => Promise<number>,
	options: any,
): Promise<void> {
	const exitCode = await command(options);
	// Force exit so open stdin handles from readline/clack don't stall the process.
	process.exit(exitCode);
}

const program = new Command();

program
	.name("vocoder")
	.description("Vocoder CLI - App setup and string extraction")
	.version("0.1.5");

program
	.command("init")
	.description("Authenticate and provision Vocoder for this app")
	.option("--api-url <url>", "Override Vocoder API URL")
	.option("--yes", "Allow overwriting existing local config values")
	.option(
		"--ci",
		"Non-interactive mode: print auth URL to stdout, skip browser open",
	)
	.option("--app-name <name>", "Starter app name to create")
	.option("--source-locale <locale>", "Source locale for the starter app")
	.option(
		"--target-locales <list>",
		"Comma-separated target locales (e.g. es,fr,de)",
	)
	.action((options) => runCommand(init, options));

program
	.command("sync")
	.description("Extract strings and sync translations")
	.option("--branch <branch>", "Override detected branch")
	.option("--mode <mode>", "Sync mode: auto, required, best-effort", "auto")
	.option("--max-wait <ms>", "Max wait for translations (ms)")
	.option("--force", "Force re-extraction even if no changes")
	.option("--dry-run", "Preview without syncing")
	.option("--no-fallback", "Disable fallback to cached translations")
	.option("--include <pattern>", "Include glob pattern", collect, [])
	.option("--exclude <pattern>", "Exclude glob pattern", collect, [])
	.option("--verbose", "Detailed output")
	.action((options) => {
		const translated: Record<string, unknown> = { ...options };
		if (options.maxWait) translated.maxWaitMs = Number(options.maxWait);
		if (options.fallback === false) translated.noFallback = true;
		return runCommand(sync, translated);
	});

program
	.command("logout")
	.description("Log out and remove stored credentials")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(logout, options));

program
	.command("whoami")
	.description("Show the currently authenticated user")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(whoami, options));

// ── App management ────────────────────────────────────────────────────────────

const localesCmd = program
	.command("locales")
	.description("Manage app target locales")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(listProjectLocales, options));

localesCmd
	.command("add <codes...>")
	.description("Add one or more target locales by BCP 47 code (e.g. fr de pt-BR)")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((codes: string[], options) =>
		runCommand((opts) => addLocales(codes, opts), options),
	);

localesCmd
	.command("remove <codes...>")
	.description("Remove one or more target locales by BCP 47 code")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((codes: string[], options) =>
		runCommand((opts) => removeLocales(codes, opts), options),
	);

localesCmd
	.command("supported")
	.description("List all locales supported by Vocoder")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(listSupportedLocales, options));

program
	.command("app")
	.alias("project")
	.description("Show current app configuration")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(appConfig, options));

program
	.command("translations")
	.description("Download the current translation snapshot")
	.option("--branch <branch>", "Git branch (auto-detected if omitted)")
	.option("--locale <locale>", "Fetch a specific locale only")
	.option("--output <dir>", "Write locale JSON files to this directory")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(getTranslations, options));

program
	.command("create-app")
	.description("Create a new Vocoder app (requires prior `vocoder init`)")
	.requiredOption("--name <name>", "App display name")
	.requiredOption("--source-locale <code>", "Source language BCP 47 code (e.g. en)")
	.requiredOption("--organization <org-id>", "Organization ID")
	.option(
		"--target-locales <codes>",
		"Comma-separated target locale codes (e.g. fr,de,pt-BR)",
	)
	.option(
		"--target-branches <branches>",
		"Comma-separated branch names to sync (default: main)",
	)
	.option(
		"--repo <canonical>",
		"Git repo canonical (e.g. github:owner/repo). Auto-detected from git remote if omitted.",
	)
	.option(
		"--app-dir <path>",
		"App directory within the repo for monorepos (default: .)",
	)
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => {
		const translated = {
			...options,
			// Commander camelCases dashed options
			sourceLocale: options.sourceLocale,
			targetLocales: options.targetLocales,
			targetBranches: options.targetBranches,
			organization: options.organization,
		};
		return runCommand(createApp, translated);
	});

program
	.command("regenerate-key")
	.description("Generate a new API key for the Vocoder app in this repo")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(regenerateKey, options));

program.parse(process.argv);
