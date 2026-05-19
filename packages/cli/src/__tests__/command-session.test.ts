import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIntro, mockOutro, mockLog, mockSpinner } = vi.hoisted(() => ({
	mockIntro: vi.fn(),
	mockOutro: vi.fn(),
	mockLog: {
		success: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
	},
	mockSpinner: {
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	},
}));

vi.mock("@clack/prompts", () => ({
	intro: mockIntro,
	outro: mockOutro,
	log: mockLog,
	spinner: () => mockSpinner,
}));

import { CommandSession } from "../utils/command-session.js";

beforeAll(() => {
	process.env.NO_COLOR = "1";
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe("CommandSession", () => {
	it("formats primary rows as label/value pairs", () => {
		const session = new CommandSession("Vocoder Test");
		session.step("Workspace", "acme");
		session.end();

		expect(mockIntro).toHaveBeenCalled();
		expect(mockLog.success).toHaveBeenCalledWith("Workspace: acme");
		expect(mockOutro).toHaveBeenCalledWith("");
	});

	it("adds an ellipsis to spinner start messages and strips it on stop", () => {
		const session = new CommandSession("Vocoder Test");
		const step = session.startStep("Loading project configuration");
		step.done("Branch: main");
		session.end();

		expect(mockSpinner.start).toHaveBeenCalledWith("Loading project configuration…");
		expect(mockSpinner.stop).toHaveBeenCalledWith("Branch: main");
	});

	it("prints spinner failures and guidance before ending", () => {
		const session = new CommandSession("Vocoder Test");
		const step = session.startStep("Fetching locale files");
		step.fail("No locale files found", ["Run vocoder translate to generate them first."]);
		session.endFailure();

		expect(mockSpinner.stop).toHaveBeenCalledWith("No locale files found", 1);
		expect(mockLog.info).toHaveBeenCalledWith(
			"Run vocoder translate to generate them first.",
		);
		expect(mockOutro).toHaveBeenCalledWith("");
	});

	it("renders section headers with a trailing colon", () => {
		const session = new CommandSession("Vocoder Test");
		session.section("Next steps");
		session.end();

		expect(mockLog.message).toHaveBeenCalledWith(expect.stringContaining("Next steps:"));
	});
});
