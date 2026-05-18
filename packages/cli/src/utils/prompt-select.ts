import { isCancel, Prompt } from "@clack/core";
import * as p from "@clack/prompts";
import { active, bld, dim, grn, info, red, ylw } from "./theme.js";

const S_BAR = "│";
const S_BAR_END = "└";
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
			return active(S_SUBMIT);
	}
}

export interface SelectOption<T extends string> {
	value: T;
	label: string;
	hint?: string;
}

/**
 * Simple select that collapses to "◆ Label: value" on submit, matching the
 * rest of the init flow. Use instead of p.select() when you want consistent
 * single-line confirmation rendering.
 */
export async function promptSelect<T extends string>(opts: {
	message: string;
	confirmLabel: string;
	options: SelectOption<T>[];
	initialValue?: T;
}): Promise<T | null> {
	const { message, confirmLabel, options } = opts;
	let cursor = options.findIndex((o) => o.value === opts.initialValue);
	if (cursor < 0) cursor = 0;

	const prompt = new (Prompt as any)(
		{
			initialValue: options[cursor]?.value ?? null,
			render(this: { state: string; value: unknown }) {
				const hdr = `${dim(S_BAR)}\n${symbol(this.state)}  ${message}\n`;

				switch (this.state) {
					case "submit": {
						const selected = options.find((o) => o.value === (this.value as string));
						return `${dim(S_BAR)}\n${grn(S_SUBMIT)}  ${confirmLabel}: ${bld(selected?.label ?? String(this.value))}`;
					}
					case "cancel":
						return `${hdr}${dim(S_BAR)}`;
					default: {
						const lines: string[] = [hdr.trimEnd()];
						for (let i = 0; i < options.length; i++) {
							const opt = options[i]!;
							const isCursor = i === cursor;
							const icon = isCursor ? active("●") : dim("○");
							const label = isCursor ? bld(opt.label) : opt.label;
							const hint = opt.hint ? `  ${dim(opt.hint)}` : "";
							lines.push(`${info(S_BAR)}  ${icon}  ${label}${hint}`);
						}
						lines.push(`${info(S_BAR_END)}`);
						lines.push("");
						return lines.join("\n");
					}
				}
			},
		},
		false, // trackValue=false — we manage value via cursor events
	) as InstanceType<typeof Prompt> & { value: unknown };

	prompt.on("cursor", (action: string | undefined) => {
		switch (action) {
			case "up":
				cursor = Math.max(0, cursor - 1);
				break;
			case "down":
				cursor = Math.min(options.length - 1, cursor + 1);
				break;
		}
		(prompt as any).value = options[cursor]?.value ?? null;
	});

	prompt.on("finalize", () => {
		if ((prompt as any).state === "submit") {
			(prompt as any).value = options[cursor]?.value ?? null;
		}
	});

	const result = await prompt.prompt();

	if (isCancel(result)) {
		p.cancel("Setup cancelled.");
		return null;
	}

	return result as T;
}

/**
 * Yes/No confirm that collapses to "◆ Label: Yes/No" on submit.
 * Use instead of p.confirm() to match the init flow's single-line rendering.
 */
export async function promptConfirm(opts: {
	message: string;
	confirmLabel: string;
	initialValue?: boolean;
}): Promise<boolean | null> {
	const result = await promptSelect({
		message: opts.message,
		confirmLabel: opts.confirmLabel,
		options: [
			{ value: "yes" as const, label: "Yes" },
			{ value: "no" as const, label: "No" },
		],
		initialValue: (opts.initialValue ?? false) ? "yes" : "no",
	});
	if (result === null) return null;
	return result === "yes";
}
