/**
 * @module mcp-setup
 *
 * Interactive prompt to add the Vocoder MCP server to the user's AI editor.
 * Handles Claude Code (runs `claude mcp add` automatically), Cursor, Windsurf,
 * VS Code, and a generic fallback that shows the raw JSON config.
 *
 * Exports: runMcpSetup, mcpServerJson
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { info } from "./theme.js";
import { printCodeBlock, printCommand } from "./output.js";

const MCP_DOCS_URL = "https://vocoder.app/docs/mcp";

/** Returns the JSON config block for adding the Vocoder MCP server to any editor. */
export function mcpServerJson(apiKey: string): string {
	return JSON.stringify(
		{
			mcpServers: {
				vocoder: {
					type: "stdio",
					command: "npx",
					args: ["-y", "@vocoder/mcp"],
					env: { VOCODER_API_KEY: apiKey },
				},
			},
		},
		null,
		2,
	);
}

/**
 * Prompts the user to select their AI editor and registers the Vocoder MCP
 * server. For Claude Code, attempts automatic registration via `claude mcp add`.
 * For all others, prints the config JSON to paste into the editor's config file.
 */
export async function runMcpSetup(apiKey: string): Promise<void> {
	type Tool = "claude" | "cursor" | "windsurf" | "vscode" | "other";

	p.log.message(
		chalk.dim(
			"  The Vocoder MCP server lets your AI editor add/remove locales,\n" +
				"  check translation status, and scaffold i18n directly in your project.",
		),
	);

	const tool = await p.select<Tool>({
		message: "Which AI editor?",
		options: [
			{ value: "claude", label: "Claude Code" },
			{ value: "cursor", label: "Cursor" },
			{ value: "windsurf", label: "Windsurf" },
			{ value: "vscode", label: "VS Code (GitHub Copilot)" },
			{ value: "other", label: "Other — show the config JSON" },
		],
	});

	if (p.isCancel(tool)) return;

	if (tool === "claude") {
		try {
			execSync(
				`claude mcp add vocoder --scope user --transport stdio -e VOCODER_API_KEY=${apiKey} -- npx -y @vocoder/mcp`,
				{ stdio: "pipe" },
			);
			p.log.success("Vocoder MCP server registered in Claude Code.");
		} catch {
			p.log.message(chalk.dim("(automatic registration failed — run this command manually:)"));
			printCommand(
				`claude mcp add vocoder --scope user --transport stdio -e VOCODER_API_KEY=${apiKey} -- npx -y @vocoder/mcp`,
			);
			p.log.message(info(`  Docs: ${MCP_DOCS_URL}`));
		}
		return;
	}

	const configPaths: Record<Exclude<Tool, "claude">, { path: string; merge: boolean }> = {
		cursor: { path: "~/.cursor/mcp.json", merge: true },
		windsurf: { path: "~/.codeium/windsurf/mcp_config.json", merge: true },
		vscode: { path: ".vscode/mcp.json", merge: true },
		other: { path: ".mcp.json", merge: false },
	};

	const { path: configPath, merge } = configPaths[tool];
	const mergeNote = merge
		? chalk.dim(`  Merge into ${configPath} (create if missing):`)
		: chalk.dim(`  Add to ${configPath}:`);

	p.log.message(mergeNote);
	printCodeBlock(mcpServerJson(apiKey));
	p.log.message(info(`  Docs: ${MCP_DOCS_URL}`));
}
