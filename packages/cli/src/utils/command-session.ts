import * as p from "@clack/prompts";
import chalk from "chalk";
import { highlight } from "./theme.js";

type SpinnerInstance = ReturnType<typeof p.spinner>;

type StepLevel = "success" | "info";

function ensureEllipsis(message: string): string {
	return message.endsWith("…") ? message : `${message}…`;
}

function stripEllipsis(message: string): string {
	return message.endsWith("…") ? message.slice(0, -1) : message;
}

function ensureSectionTitle(title: string): string {
	return title.endsWith(":") ? title : `${title}:`;
}

export function formatLabelValue(label: string, value: string): string {
	return `${label}: ${value}`;
}

export function joinHighlighted(values: string[]): string {
	return values.map((value) => highlight(value)).join(", ");
}

export function displayAppDir(
	appDir: string,
	options: { showRootLabel?: boolean } = {},
): string {
	if (appDir) return appDir;
	return options.showRootLabel ? "(root)" : "";
}

export class CommandSession {
	private activeSpinner: CommandStep | null = null;
	private closed = false;

	constructor(title: string) {
		p.intro(chalk.bold(title));
	}

	step(label: string, value: string, level: StepLevel = "success"): void {
		this.assertReady();
		const message = formatLabelValue(label, value);
		if (level === "success") {
			p.log.success(message);
			return;
		}
		p.log.info(message);
	}

	success(message: string): void {
		this.assertReady();
		p.log.success(message);
	}

	warn(message: string): void {
		this.assertReady();
		p.log.warn(message);
	}

	error(message: string): void {
		this.assertReady();
		p.log.error(message);
	}

	info(message: string): void {
		this.assertReady();
		p.log.info(message);
	}

	blank(): void {
		this.info("");
	}

	section(title: string): void {
		this.assertReady();
		p.log.message(chalk.bold(ensureSectionTitle(title)));
	}

	message(message: string): void {
		this.assertReady();
		p.log.message(message);
	}

	startStep(message: string): CommandStep {
		this.assertReady();
		if (this.activeSpinner) {
			throw new Error("A spinner is already running.");
		}
		const spinner = p.spinner();
		spinner.start(ensureEllipsis(message));
		const step = new CommandStep(this, spinner);
		this.activeSpinner = step;
		return step;
	}

	fail(message: string, guidance: string[] = [], outro = ""): number {
		this.error(message);
		this.printGuidance(guidance);
		return this.finish(1, outro);
	}

	cancelled(): number {
		return this.finish(1, "");
	}

	end(message = ""): number {
		return this.finish(0, message);
	}

	endFailure(message = ""): number {
		return this.finish(1, message);
	}

	endFatal(message: string): number {
		return this.finish(1, chalk.red(message));
	}

	closeActiveStep(step: CommandStep): void {
		if (this.activeSpinner !== step) {
			throw new Error("Attempted to close an inactive spinner.");
		}
		this.activeSpinner = null;
	}

	private printGuidance(guidance: string[]): void {
		for (const line of guidance) {
			this.info(line);
		}
	}

	private finish(code: number, message: string): number {
		if (this.closed) {
			return code;
		}
		if (this.activeSpinner) {
			throw new Error("Cannot finish a command while a spinner is running.");
		}
		p.outro(message);
		this.closed = true;
		return code;
	}

	private assertReady(): void {
		if (this.closed) {
			throw new Error("Command output is already closed.");
		}
		if (this.activeSpinner) {
			throw new Error("Cannot log while a spinner is running.");
		}
	}
}

export class CommandStep {
	constructor(
		private readonly session: CommandSession,
		private readonly spinner: SpinnerInstance,
	) {}

	update(message: string): void {
		this.spinner.message(stripEllipsis(message));
	}

	done(message: string): void {
		this.spinner.stop(stripEllipsis(message));
		this.session.closeActiveStep(this);
	}

	fail(message: string, guidance: string[] = []): void {
		this.spinner.stop(stripEllipsis(message), 1);
		this.session.closeActiveStep(this);
		for (const line of guidance) {
			this.session.info(line);
		}
	}
}
