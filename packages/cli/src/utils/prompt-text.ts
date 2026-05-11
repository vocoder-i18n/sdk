import { TextPrompt, isCancel } from "@clack/core";
import * as p from "@clack/prompts";
import chalk from "chalk";

const BAR = "│"; // │
const BOTTOM = "└"; // └
const FILLED = "◆"; // ◆
const SQUARE = "■"; // ■
const TRIANGLE = "▲"; // ▲

function placeholderDisplay(placeholder: string | undefined): string {
	if (!placeholder) return chalk.inverse(chalk.hidden("_"));
	return chalk.inverse(placeholder[0]!) + chalk.dim(placeholder.slice(1));
}

export interface PromptTextParams {
	message: string;
	placeholder?: string;
	initialValue?: string;
	/** Shown as "Label: value" in the single-line confirmation after submit. */
	confirmLabel: string;
	validate?: (value: string) => string | undefined;
}

/**
 * Single-line confirming text input. Collapses to "◆ Label: value" on submit
 * instead of clack's default two-line dim rendering, keeping the flow clean.
 *
 * Returns the trimmed value, or null if cancelled.
 */
export async function promptTextInput(params: PromptTextParams): Promise<string | null> {
	const { message, placeholder, initialValue, confirmLabel, validate } = params;

	const prompt = new TextPrompt({
		placeholder,
		initialValue,
		validate,
		render() {
			const bar = chalk.gray(BAR);

			if (this.state === "submit") {
				return `${bar}\n${chalk.green(FILLED)}  ${confirmLabel}: ${chalk.bold(this.value)}`;
			}

			if (this.state === "cancel") {
				const cancelled = this.value ? chalk.strikethrough(chalk.dim(this.value)) : "";
				return `${bar}\n${chalk.red(SQUARE)}  ${message}${cancelled ? `\n${bar}  ${cancelled}` : ""}`;
			}

			const displayValue = this.value ? this.valueWithCursor : placeholderDisplay(placeholder);

			if (this.state === "error") {
				return [
					`${bar}`,
					`${chalk.yellow(TRIANGLE)}  ${message}`,
					`${chalk.yellow(BAR)}  ${displayValue}`,
					`${chalk.yellow(BOTTOM)}  ${chalk.yellow(this.error)}`,
				].join("\n");
			}

			// initial / active
			return [
				`${bar}`,
				`${chalk.cyan(FILLED)}  ${message}`,
				`${chalk.cyan(BAR)}  ${displayValue}`,
				`${chalk.cyan(BOTTOM)}`,
			].join("\n");
		},
	});

	const result = await prompt.prompt();

	if (isCancel(result)) {
		p.cancel("Setup cancelled.");
		return null;
	}

	return (result as string).trim();
}
