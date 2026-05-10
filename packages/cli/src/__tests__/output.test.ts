import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	printCodeBlock,
	printCommand,
	tryClipboard,
	writeApiKeyToEnv,
} from "../utils/output.js";

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	log: {
		message: vi.fn(),
		success: vi.fn(),
	},
}));

import { execSync } from "node:child_process";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "vocoder-output-test-"));
	vi.clearAllMocks();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── tryClipboard ──────────────────────────────────────────────────────────────

describe("tryClipboard", () => {
	it("returns true when a clipboard tool succeeds", () => {
		vi.mocked(execSync).mockReturnValueOnce(Buffer.from(""));
		expect(tryClipboard("hello")).toBe(true);
	});

	it("returns false when all clipboard tools fail", () => {
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error("not found");
		});
		expect(tryClipboard("hello")).toBe(false);
	});

	it("tries the next tool on failure", () => {
		let callCount = 0;
		vi.mocked(execSync).mockImplementation(() => {
			callCount++;
			if (callCount < 3) throw new Error("not found");
			return Buffer.from("");
		});
		expect(tryClipboard("hello")).toBe(true);
		expect(callCount).toBe(3);
	});
});

// ── printCommand ──────────────────────────────────────────────────────────────

describe("printCommand", () => {
	it("writes $ prefix and command on same line", () => {
		vi.mocked(execSync).mockImplementation(() => {
			throw new Error("no clipboard");
		});
		const writes: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});

		printCommand("npm install");

		spy.mockRestore();
		const output = writes.join("");
		expect(output).toContain("$");
		expect(output).toContain("npm install");
		// Should be a single line (no multi-line box decorations)
		const lines = output.split("\n").filter((l) => l.trim());
		const commandLine = lines.find((l) => l.includes("npm install"))!;
		expect(commandLine).toContain("$");
	});

	it("emits clipboard note when copy succeeds", () => {
		vi.mocked(execSync).mockReturnValueOnce(Buffer.from(""));
		const writes: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});

		printCommand("npm install");

		spy.mockRestore();
		const output = writes.join("");
		expect(output).toContain("copied to clipboard");
	});
});

// ── printCodeBlock ────────────────────────────────────────────────────────────

describe("printCodeBlock", () => {
	it("indents each line by 2 spaces", () => {
		const writes: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});

		printCodeBlock("line one\nline two");

		spy.mockRestore();
		const lines = writes.join("").split("\n").filter((l) => l.length > 0);
		for (const line of lines) {
			expect(line).toMatch(/^ {2}/);
		}
	});

	it("does not include box-drawing characters", () => {
		const writes: string[] = [];
		const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			writes.push(String(chunk));
			return true;
		});

		printCodeBlock("hello world");

		spy.mockRestore();
		const output = writes.join("");
		expect(output).not.toMatch(/[┌┐└┘│─╭╮╰╯]/);
	});
});

// ── writeApiKeyToEnv ──────────────────────────────────────────────────────────

describe("writeApiKeyToEnv", () => {
	it("creates .env.local when neither .env nor .env.local exists", () => {
		const result = writeApiKeyToEnv("key123", tmpDir);
		expect(result).toBe(".env.local");
		const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
		expect(content).toContain("VOCODER_API_KEY=key123");
	});

	it("prefers .env.local over .env when both exist", () => {
		writeFileSync(join(tmpDir, ".env"), "OTHER_VAR=foo\n");
		writeFileSync(join(tmpDir, ".env.local"), "EXISTING=bar\n");
		const result = writeApiKeyToEnv("key123", tmpDir);
		expect(result).toBe(".env.local");
		const content = readFileSync(join(tmpDir, ".env.local"), "utf-8");
		expect(content).toContain("VOCODER_API_KEY=key123");
	});

	it("appends key to existing .env when no .env.local exists", () => {
		const envPath = join(tmpDir, ".env");
		writeFileSync(envPath, "OTHER_VAR=foo\n");
		const result = writeApiKeyToEnv("key123", tmpDir);
		expect(result).toBe(".env");
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("VOCODER_API_KEY=key123");
		expect(content).toContain("OTHER_VAR=foo");
	});

	it("updates existing VOCODER_API_KEY in .env", () => {
		const envPath = join(tmpDir, ".env");
		writeFileSync(envPath, "VOCODER_API_KEY=old_key\nOTHER=val\n");
		writeApiKeyToEnv("new_key", tmpDir);
		const content = readFileSync(envPath, "utf-8");
		expect(content).toContain("VOCODER_API_KEY=new_key");
		expect(content).not.toContain("VOCODER_API_KEY=old_key");
	});
});
