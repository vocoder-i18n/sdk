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
import { config } from "./commands/config.js";
import { translate } from "./commands/translate.js";
import { pull } from "./commands/pull.js";
import { createProject } from "./commands/create-project.js";
import { regenerateKey } from "./commands/regenerate-key.js";
import { whoami } from "./commands/whoami.js";

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
	.option("--verbose", "Log each API request URL and response status")
	.action((options) => runCommand(init, options));

program
	.command("translate")
	.description("Extract strings and sync translations via Vocoder (called by the GitHub Action)")
	.option("--branch <branch>", "Override detected branch")
	.option("--commit-sha <sha>", "Override detected commit SHA")
	.option("--dry-run", "Extract strings and compute hash without submitting")
	.option("--verbose", "Detailed output")
	.option("--api-url <url>", "Override Vocoder API URL")
	.option(
		"--app-dirs <dirs>",
		"Comma-separated app directories for monorepos (e.g. apps/web,apps/admin). Empty for single-app repos.",
	)
	.action((options) => runCommand(translate, options));

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
	.command("config")
	.description("Show current project configuration")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(config, options));

program
	.command("pull")
	.description(
		"Fetch the compiled translation bundle for the current app — identical to what __VOCODER_BUNDLE__ contains at runtime (includes overrides). " +
			"Use --snapshot for a raw branch-based audit view instead.",
	)
	.option(
		"--app-dirs <dirs>",
		"Comma-separated app directories for monorepos (e.g. apps/web,apps/admin). Auto-detected from cwd if omitted.",
	)
	.option("--locale <locale>", "Filter output to a specific locale only")
	.option(
		"--output <dir>",
		"Write one <locale>.json per locale to this directory instead of printing to stdout",
	)
	.option("--api-url <url>", "Override Vocoder API URL")
	.option(
		"--snapshot",
		"Audit mode: fetch raw Translation rows by branch (does not include overrides, use for audit/debugging only)",
	)
	.option("--branch <branch>", "Branch for --snapshot mode (auto-detected if omitted)")
	.action((options) => runCommand(pull, options));

program
	.command("create-project")
	.description("Create a new Vocoder project without the interactive init flow (requires prior `vocoder init`)")
	.requiredOption("--name <name>", "Project display name")
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
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => {
		return runCommand(createProject, options);
	});

program
	.command("regenerate-key")
	.description("Generate a new API key for the Vocoder app in this repo")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(regenerateKey, options));

program.parse(process.argv);
