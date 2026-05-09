import { isCancel, Prompt } from "@clack/core";
import * as p from "@clack/prompts";
import { active, bld, dim, grn, info, red, ylw } from "./theme.js";

export interface LocaleOption {
	bcp47: string;
	/** Human-readable label, e.g. "English — en" */
	label: string;
}

// ── Symbols (match @clack/prompts style) ──────────────────────────────────────

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

// ── Filter ────────────────────────────────────────────────────────────────────

const MAX_VISIBLE = 12;

function filterLocales(options: LocaleOption[], query: string): LocaleOption[] {
	if (!query.trim()) return options;
	const lower = query.toLowerCase();
	return options.filter(
		(o) =>
			o.bcp47.toLowerCase().includes(lower) ||
			o.label.toLowerCase().includes(lower),
	);
}

// ── List renderer ─────────────────────────────────────────────────────────────

function buildList(
	filtered: LocaleOption[],
	cursor: number,
	scrollOffset: number,
	selected: Set<string> | null, // null = single-select
): string {
	const isMulti = selected !== null;
	const end = Math.min(filtered.length, scrollOffset + MAX_VISIBLE);
	const visibleLines: string[] = [info(S_BAR)];

	for (let i = scrollOffset; i < end; i++) {
		const opt = filtered[i]!;
		const isCursor = i === cursor;
		const isChecked = isMulti && selected!.has(opt.bcp47);

		const icon = isMulti
			? isChecked
				? isCursor
					? info("◼")
					: info("◼")
				: isCursor
					? active("◻")
					: dim("◻")
			: isCursor
				? active("●")
				: dim("○");

		visibleLines.push(
			`${info(S_BAR)}  ${icon}  ${isCursor ? bld(opt.label) : opt.label}`,
		);
	}

	const hidden = filtered.length - (end - scrollOffset);
	if (hidden > 0)
		visibleLines.push(dim(`${S_BAR}  ${hidden} more — keep typing to narrow`));
	if (filtered.length === 0) visibleLines.push(dim(`${S_BAR}  No matches`));

	return visibleLines.join("\n");
}

// ── Core prompt factory ───────────────────────────────────────────────────────

async function runFilterablePrompt(opts: {
	message: string;
	options: LocaleOption[];
	multi: boolean;
	initialValue?: string;
	initialValues?: string[];
}): Promise<string | string[] | null> {
	const { message, options, multi } = opts;

	let filter = "";
	let cursor = 0;
	let scrollOffset = 0;
	const selected = new Set<string>(multi ? (opts.initialValues ?? []) : []);

	if (!multi && opts.initialValue) {
		const idx = options.findIndex((o) => o.bcp47 === opts.initialValue);
		if (idx >= 0) cursor = idx;
	}

	const getFiltered = () => filterLocales(options, filter);

	// Keep cursor in bounds and scroll window centred
	const clampCursor = (filtered: LocaleOption[]) => {
		if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1);
		if (cursor < scrollOffset) scrollOffset = cursor;
		if (cursor >= scrollOffset + MAX_VISIBLE)
			scrollOffset = cursor - MAX_VISIBLE + 1;
		if (scrollOffset < 0) scrollOffset = 0;
	};

	// @clack/core Prompt: render() returns the ENTIRE frame; clack handles
	// re-rendering (cursor movement + diff) automatically.
	// Using `any` cast to pass `trackValue=false` (2nd constructor arg).
	const prompt = new (Prompt as any)(
		{
			initialValue: !multi ? (options[cursor]?.bcp47 ?? null) : null,
			validate() {
				const f = getFiltered();
				if (multi && selected.size === 0)
					return "At least one target language is required.";
				if (!multi && !f[cursor]) return "Please select a language.";
				return undefined;
			},
			render(this: { state: string; error: string; value: unknown }) {
				const filtered = getFiltered();
				clampCursor(filtered);

				const hdr = `${dim(S_BAR)}\n${symbol(this.state)}  ${message}\n`;
				const inputHint = filter.length > 0 ? filter : dim("type to filter");

				const footer = multi
					? selected.size > 0
						? dim(`${S_BAR}  ${selected.size} selected  ·  ↑↓ navigate  ·  Space to select  ·  Enter to confirm`)
						: dim(`${S_BAR}  ↑↓ navigate  ·  Space to select  ·  Enter to confirm`)
					: dim(`${S_BAR}  ↑↓ navigate  ·  Enter to confirm`);

				switch (this.state) {
					case "submit": {
						const val = multi
							? Array.from(selected)
									.map((id) => options.find((o) => o.bcp47 === id)?.label ?? id)
									.join(", ")
							: (options.find((o) => o.bcp47 === (this.value as string))
									?.label ?? "");
						return `${hdr}${dim(S_BAR)}  ${bld(val || dim("none"))}`;
					}
					case "cancel":
						return `${hdr}${dim(S_BAR)}`;
					case "error":
						return [
							hdr.trimEnd(),
							`${ylw(S_BAR)}  ${dim("/")} ${inputHint}`,
							buildList(filtered, cursor, scrollOffset, multi ? selected : null),
							footer,
							`${ylw(S_BAR_END)}  ${ylw(this.error)}`,
							"",
						].join("\n");
					default:
						return [
							hdr.trimEnd(),
							`${info(S_BAR)}  ${dim("/")} ${inputHint}`,
							buildList(filtered, cursor, scrollOffset, multi ? selected : null),
							footer,
							`${info(S_BAR_END)}`,
							"",
						].join("\n");
				}
			},
		},
		false, // trackValue=false — we manage value manually
	) as InstanceType<typeof Prompt> & { value: unknown; state: string };

	// Character input → update filter
	prompt.on("key", (key: string | undefined) => {
		if (!key || key === " ") return; // space handled by cursor event
		const cp = key.codePointAt(0) ?? 0;
		if (cp === 0x7f || cp === 0x08) {
			// backspace
			filter = filter.slice(0, -1);
			cursor = 0;
			scrollOffset = 0;
		} else if (cp >= 32 && cp !== 127) {
			filter += key;
			cursor = 0;
			scrollOffset = 0;
		}
	});

	// Navigation + toggle
	prompt.on("cursor", (action: string | undefined) => {
		const filtered = getFiltered();
		switch (action) {
			case "up":
				cursor = Math.max(0, cursor - 1);
				break;
			case "down":
				cursor = Math.min(Math.max(filtered.length - 1, 0), cursor + 1);
				break;
			case "space":
				if (multi) {
					const opt = filtered[cursor];
					if (opt) {
						if (selected.has(opt.bcp47)) selected.delete(opt.bcp47);
						else selected.add(opt.bcp47);
					}
				}
				break;
		}
		// Sync prompt.value for single-select so submit gets the right value
		if (!multi) {
			const opt = getFiltered()[cursor];
			(prompt as any).value = opt?.bcp47 ?? null;
		}
	});

	// Before submit resolves, set value to the selected items (multi) or current cursor (single)
	prompt.on("finalize", () => {
		if ((prompt as any).state === "submit") {
			if (multi) {
				(prompt as any).value = Array.from(selected);
			} else {
				const f = getFiltered();
				(prompt as any).value = f[cursor]?.bcp47 ?? null;
			}
		}
	});

	const result = await prompt.prompt();

	if (isCancel(result)) return null;
	return result as string | string[];
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function searchSelectLocale(
	options: LocaleOption[],
	message: string,
	initialValue?: string,
): Promise<string | null> {
	const result = await runFilterablePrompt({
		message,
		options,
		multi: false,
		initialValue,
	});
	return typeof result === "string" ? result : null;
}

export async function searchMultiSelectLocales(
	options: LocaleOption[],
	message: string,
	initialValues?: string[],
): Promise<string[] | null> {
	const result = await runFilterablePrompt({
		message,
		options,
		multi: true,
		initialValues,
	});
	if (result === null) return null;
	const picks = result as string[];
	// Validate already prevents empty on first try; this handles the retry path
	if (picks.length === 0) {
		p.log.warn(
			"At least one target language is required. Please select at least one.",
		);
		return searchMultiSelectLocales(options, message, initialValues);
	}
	return picks;
}
