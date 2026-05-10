import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { isCancel, Prompt } from "@clack/core";
import * as p from "@clack/prompts";
import { active, bld, dim, grn, info, red, ylw } from "./theme.js";

// ── Symbols ───────────────────────────────────────────────────────────────────

const S_BAR = "│";
const S_BAR_END = "└";
const S_ACTIVE = "◆";
const S_SUBMIT = "◆";
const S_CANCEL = "■";
const S_ERROR = "▲";

function symbol(state: string): string {
	switch (state) {
		case "submit":
			return grn(S_SUBMIT);
		case "cancel":
			return red(S_CANCEL);
		case "error":
			return ylw(S_ERROR);
		default:
			return active(S_ACTIVE);
	}
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate an app directory path. Returns an error string or null if valid.
 * Checks path safety, mutual exclusion invariant, and filesystem existence.
 */
export function validateAppDirPath(
	val: string,
	existing: string[],
	opts: { cwd?: string } = {},
): string | null {
	if (val.startsWith("/")) return "Must be a relative path (e.g. apps/web)";
	if (val.includes("..")) return "Path traversal not allowed";

	const hasWholeRepo = existing.includes("");
	const hasScoped = existing.some((d) => d !== "");
	if (val === "" && hasScoped) return "Cannot add whole-repo scope to a monorepo project";
	if (val !== "" && hasWholeRepo) return "Cannot add a scoped directory to a whole-repo project";
	if (existing.includes(val)) return `Already added: ${val}`;

	// Reject nested paths — e.g. adding "apps" when "apps/vite" already exists (or vice versa)
	const nested = existing.find(
		(d) => d !== "" && (val.startsWith(d + "/") || d.startsWith(val + "/")),
	);
	if (nested) return `"${val}" overlaps with already-added "${nested}"`;

	if (val !== "") {
		const abs = resolve(opts.cwd ?? process.cwd(), val);
		if (!existsSync(abs)) return `Directory not found: ${val}`;
		if (!statSync(abs).isDirectory()) return `Not a directory: ${val}`;
	}

	return null;
}

// ── collectAppDirs ────────────────────────────────────────────────────────────

/**
 * Interactively collect app directory paths from the user for monorepo projects.
 *
 * Type a path → press Space to add it. Navigate ↑↓ to existing dirs and press
 * Space to remove. Press Enter when done. An empty submission (no dirs added)
 * means single-app / whole-repo project.
 *
 * @param opts.maxDirs - Maximum directories the user may add. When reached the
 *   Space key is blocked and the render shows "App limit reached (N/N on your
 *   plan)" in place of the add affordance. The server also enforces this limit
 *   on creation — this is a UX-level guard to surface the constraint early.
 *
 * Returns the collected directories, or null if the user cancels.
 */
export async function collectAppDirs(opts: { cwd?: string; maxDirs?: number } = {}): Promise<string[] | null> {
	const added: string[] = [];
	let filter = "";
	let cursor = 0;
	let addCursor = false;

	const isNewDir = () => {
		const t = filter.trim();
		return t.length > 0 && !added.includes(t);
	};

	const clampCursor = () => {
		const max = added.length - 1;
		if (cursor > max) cursor = Math.max(0, max);
	};

	const prompt = new (Prompt as any)(
		{
			validate() {
				return undefined;
			},
			render(this: { state: string; error: string }) {
				const trimmed = filter.trim();
				const hdr = `${dim(S_BAR)}\n${symbol(this.state)}  App directories\n`;

				switch (this.state) {
					case "submit": {
						const summary =
							added.length > 0
								? bld(added.join(", "))
								: dim("none (single-app project)");
						return `${hdr}${dim(S_BAR)}  ${summary}`;
					}
					case "cancel":
						return `${hdr}${dim(S_BAR)}`;
					default: {
						const inputHint =
							filter.length > 0
								? filter
								: added.length === 0
									? dim("e.g. apps/web")
									: dim("e.g. apps/api");

						const lines: string[] = [
							hdr.trimEnd(),
							`${info(S_BAR)}  ${dim("/")} ${inputHint}`,
							info(S_BAR),
						];

						for (let i = 0; i < added.length; i++) {
							const isCursor = i === cursor && !addCursor;
							const icon = active("◼");
							const label = isCursor ? bld(added[i]!) : added[i]!;
							lines.push(`${info(S_BAR)}  ${icon}  ${label}`);
						}

						const atLimit = opts.maxDirs !== undefined && added.length >= opts.maxDirs;
						if (atLimit) {
							lines.push(`${info(S_BAR)}  ${dim(`App limit reached (${added.length}/${opts.maxDirs} on your plan)`)}`);
						} else if (isNewDir()) {
							const err = validateAppDirPath(trimmed, added, opts);
							const icon = addCursor ? active("◻") : dim("◻");
							const label = err
								? `${ylw("+")}  ${dim(`"${trimmed}" — ${err}`)}`
								: `${grn("+")}  Add "${trimmed}"`;
							lines.push(`${info(S_BAR)}  ${icon}  ${label}`);
						}

						lines.push(info(S_BAR));

						if (atLimit) {
							lines.push(dim(`${S_BAR}  ↑↓ to select, Space to remove  ·  Enter to confirm`));
						} else if (added.length === 0 && !isNewDir()) {
							lines.push(dim(`${S_BAR}  Monorepo? Type each app's subdirectory path and press Space.`));
							lines.push(dim(`${S_BAR}  Single app? Press Enter to skip this step.`));
						} else if (added.length > 0) {
							lines.push(dim(`${S_BAR}  ${added.length} added  ·  ↑↓ to select, Space to remove  ·  Enter to confirm`));
						}

						const barEnd =
							this.state === "error" ? ylw(S_BAR_END) : info(S_BAR_END);
						if (this.state === "error") {
							lines.push(`${ylw(S_BAR_END)}  ${ylw(this.error)}`);
						} else {
							lines.push(barEnd);
						}

						lines.push("");
						return lines.join("\n");
					}
				}
			},
		},
		false,
	) as InstanceType<typeof Prompt> & { value: unknown; state: string };

	prompt.on("key", (key: string | undefined) => {
		if (!key || key === " ") return;
		const cp = key.codePointAt(0) ?? 0;
		if (cp === 0x7f || cp === 0x08) {
			filter = filter.slice(0, -1);
			addCursor = false;
		} else if (cp >= 32 && cp !== 127) {
			filter += key;
			cursor = 0;
			addCursor = false;
		}
	});

	prompt.on("cursor", (action: string | undefined) => {
		switch (action) {
			case "up":
				if (addCursor) {
					addCursor = false;
					cursor = Math.max(0, added.length - 1);
				} else {
					cursor = Math.max(0, cursor - 1);
				}
				break;
			case "down":
				if (!addCursor && cursor >= added.length - 1 && isNewDir()) {
					addCursor = true;
				} else if (!addCursor) {
					cursor = Math.min(added.length - 1, cursor + 1);
				}
				break;
			case "space": {
				if (addCursor || (filter.trim().length > 0 && isNewDir())) {
					if (opts.maxDirs !== undefined && added.length >= opts.maxDirs) break;
					const trimmed = filter.trim();
					const err = validateAppDirPath(trimmed, added, opts);
					if (!err) {
						added.push(trimmed);
						filter = "";
						addCursor = false;
						cursor = 0;
					}
				} else if (added.length > 0 && !isNewDir()) {
					clampCursor();
					added.splice(cursor, 1);
					if (cursor >= added.length) cursor = Math.max(0, added.length - 1);
				}
				break;
			}
		}
	});

	prompt.on("finalize", () => {
		if ((prompt as any).state === "submit") {
			(prompt as any).value = [...added];
		}
	});

	const result = await prompt.prompt();
	if (isCancel(result)) return null;
	return result as string[];
}

// ── promptSingleAppDir ────────────────────────────────────────────────────────

/**
 * Prompt the user for a single app directory to add to an existing project.
 *
 * Validates path safety, filesystem existence, and the monorepo/whole-repo
 * mutual exclusion invariant against the provided existing directories.
 *
 * Returns the entered directory string, or null if the user cancels.
 */
export async function promptSingleAppDir(params: {
	existingDirs: string[];
	cwd?: string;
}): Promise<string | null> {
	const { existingDirs, cwd } = params;

	const input = await p.text({
		message: "App directory to add",
		placeholder: "apps/web",
		validate(val) {
			// Mutual exclusion checked before required — empty string is a valid whole-repo intent
			const err = validateAppDirPath(val ?? "", existingDirs, { cwd });
			if (err) return err;
			if (!val) return "Directory is required";
			return undefined;
		},
	});

	if (p.isCancel(input)) return null;
	return input as string;
}
