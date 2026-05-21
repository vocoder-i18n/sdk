#!/usr/bin/env node

import { Command } from "commander";
import packageJson from "../package.json";
import { authLogin } from "./commands/auth-login.js";
import { authLogout } from "./commands/auth-logout.js";
import { authStatus } from "./commands/auth-status.js";
import { init } from "./commands/init.js";
import {
	addLocales,
	listProjectLocales,
	listSupportedLocales,
	removeLocales,
} from "./commands/locales.js";
import { config } from "./commands/config.js";
import { translate } from "./commands/translate.js";
import { clean } from "./commands/clean.js";
import { pull } from "./commands/pull.js";
import { createProject } from "./commands/create-project.js";
import { regenerateKey } from "./commands/regenerate-key.js";

async function runCommand<TOptions>(
	command: (options: TOptions) => Promise<number>,
	options: TOptions,
): Promise<void> {
	const exitCode = await command(options);
	// Force exit so open stdin handles from readline/clack don't stall the process.
	process.exit(exitCode);
}

const program = new Command();

program
	.name("vocoder")
	.description("Vocoder CLI for setup, translation sync, and project management")
	.version(packageJson.version);

program
	.command("init")
	.description("Authenticate and provision Vocoder for this app")
	.option("--api-url <url>", "Override Vocoder API URL")
	.option("--yes", "Allow overwriting existing local config values")
	.option(
		"--ci",
		"Non-interactive mode: print auth URL to stdout, skip browser open",
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
		"--app-dir <dir>",
		"Single app directory to process (e.g. apps/web). Overrides vocoder.config.ts apps[]. Omit for the common case.",
	)
	.action((options) => runCommand(translate, options));

const authCmd = program
	.command("auth")
	.description("Manage Vocoder account authentication");

authCmd
	.command("login")
	.description("Sign in to your Vocoder account")
	.option("--api-url <url>", "Override Vocoder API URL")
	.option("--yes", "Skip the browser-open confirmation")
	.option(
		"--ci",
		"Non-interactive mode: print auth URL to stdout, skip browser open",
	)
	.option("--verbose", "Log each API request URL and response status")
	.action((options) => runCommand(authLogin, options));

authCmd
	.command("status")
	.description("Show the current account authentication status")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(authStatus, options));

authCmd
	.command("logout")
	.description("Log out and remove stored credentials")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(authLogout, options));

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
		"Fetch the latest compiled locale files for the current branch and write them into your project",
	)
	.option(
		"--app-dirs <dirs>",
		"Comma-separated app directories for monorepos (e.g. apps/web,apps/admin). Omit for single-app repos.",
	)
	.option("--output <dir>", "Write locale files to this directory instead of the git root")
	.option("--api-url <url>", "Override Vocoder API URL")
	.option("--branch <branch>", "Branch to pull locale files for (auto-detected if omitted)")
	.action((options) => runCommand(pull, options));

program
	.command("clean")
	.description("Remove locale files not in the current target locales")
	.option(
		"--app-dir <dir>",
		"Single app directory to process (e.g. apps/web). Overrides vocoder.config.ts apps[]. Omit for the common case.",
	)
	.option("--yes", "Skip the confirmation prompt and delete without asking")
	.option("--api-url <url>", "Override Vocoder API URL")
	.action((options) => runCommand(clean, options));

program
	.command("create-project")
	.description("Create a new Vocoder project without running the full init wizard")
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
