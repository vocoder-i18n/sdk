/**
 * @module output
 *
 * Terminal output helpers for the init command: API key display, env file writing,
 * clipboard copy, and formatted command/code-block rendering.
 *
 * Exports: tryClipboard, printCommand, printCodeBlock, printApiKey, writeApiKeyToEnv
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tries to copy text to the system clipboard using common CLI tools.
 * Returns true if any tool succeeded.
 */
export function tryClipboard(text: string): boolean {
	const tools: Array<{ cmd: string; args?: string[] }> = [
		{ cmd: "pbcopy" },
		{ cmd: "xclip", args: ["-selection", "clipboard"] },
		{ cmd: "xsel", args: ["--clipboard", "--input"] },
		{ cmd: "wl-copy" },
		{ cmd: "clip" },
	];
	for (const { cmd, args = [] } of tools) {
		try {
			execSync([cmd, ...args].join(" "), {
				input: text,
				stdio: ["pipe", "ignore", "ignore"],
			});
			return true;
		} catch {
			continue;
		}
	}
	return false;
}

/**
 * Prints a shell command prefixed with `$`, auto-copies to clipboard, and
 * notes if the copy succeeded. Single-line format avoids box-drawing characters
 * that terminal selection includes verbatim.
 */
export function printCommand(cmd: string): void {
	const copied = tryClipboard(cmd);
	process.stdout.write("\n");
	process.stdout.write(`  ${chalk.dim("$")} ${chalk.cyan(cmd)}\n`);
	if (copied) process.stdout.write(`  ${chalk.dim("↑ copied to clipboard")}\n`);
	process.stdout.write("\n");
}

/**
 * Prints a multi-line code block with 2-space indentation. No box characters —
 * safe for terminal copy-paste selection.
 */
export function printCodeBlock(code: string): void {
	process.stdout.write("\n");
	for (const line of code.split("\n")) {
		process.stdout.write(`  ${line}\n`);
	}
	process.stdout.write("\n");
}

/**
 * Writes VOCODER_API_KEY to the .env file at repoRoot (or cwd).
 * Updates an existing entry in-place; appends if absent. Returns false if no .env exists.
 */
export function writeApiKeyToEnv(apiKey: string, repoRoot?: string): boolean {
	const envPath = join(repoRoot ?? process.cwd(), ".env");
	if (!existsSync(envPath)) return false;

	try {
		const content = readFileSync(envPath, "utf-8");
		const keyLine = `VOCODER_API_KEY=${apiKey}`;
		let updated: string;

		if (/^VOCODER_API_KEY=/m.test(content)) {
			updated = content.replace(/^VOCODER_API_KEY=.*/m, keyLine);
		} else {
			const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
			updated = `${content}${sep}${keyLine}\n`;
		}

		writeFileSync(envPath, updated);
		return true;
	} catch {
		return false;
	}
}

/**
 * Displays the API key, saves it to .env if possible, and instructs the user
 * to add it manually otherwise.
 */
export function printApiKey(apiKey: string, repoRoot?: string): void {
	const saved = writeApiKeyToEnv(apiKey, repoRoot);

	p.log.message("");
	p.log.message(chalk.bold("Your API Key"));
	printCodeBlock(`VOCODER_API_KEY=${apiKey}`);
	if (saved) {
		p.log.success(chalk.dim("Saved to .env"));
	} else {
		p.log.message(chalk.dim("  Add the above to your .env file"));
	}
}
