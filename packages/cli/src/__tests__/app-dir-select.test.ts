import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	collectAppDirs,
	promptSingleAppDir,
	validateAppDirPath,
} from "../utils/app-dir-select.js";

// collectAppDirs uses @clack/core's Prompt directly (not p.text) so interactive
// behaviour (key handling, render output) cannot be unit-tested via mocks.
// - Path validation is covered through validateAppDirPath tests below.
// - maxDirs enforcement is in the space-key handler (blocks add when at limit)
//   and the render (shows "App limit reached" note). The server also enforces
//   this limit on POST /api/cli/apps, so the UX guard is belt-and-suspenders.
vi.mock("@clack/prompts", () => ({
	text: vi.fn(),
	isCancel: vi.fn((v) => v === Symbol.for("clack-cancel")),
	log: { success: vi.fn() },
}));

const CANCEL = Symbol.for("clack-cancel");

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "vocoder-test-"));
	vi.clearAllMocks();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── validateAppDirPath ────────────────────────────────────────────────────────

describe("validateAppDirPath", () => {
	it("accepts empty string (skip / whole-repo signal)", () => {
		expect(validateAppDirPath("", [], { cwd: tmpDir })).toBeNull();
	});

	it("rejects absolute paths", () => {
		expect(validateAppDirPath("/absolute/path", [], { cwd: tmpDir })).toMatch(/relative/i);
	});

	it("rejects path traversal", () => {
		expect(validateAppDirPath("../outside", [], { cwd: tmpDir })).toMatch(/traversal/i);
	});

	it("rejects non-existent directory", () => {
		expect(validateAppDirPath("apps/web", [], { cwd: tmpDir })).toMatch(/not found/i);
	});

	it("rejects a file that is not a directory", () => {
		writeFileSync(join(tmpDir, "file.txt"), "");
		expect(validateAppDirPath("file.txt", [], { cwd: tmpDir })).toMatch(/not a directory/i);
	});

	it("accepts a valid existing directory", () => {
		mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
		expect(validateAppDirPath("apps/web", [], { cwd: tmpDir })).toBeNull();
	});

	it("rejects duplicate directory", () => {
		mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
		expect(validateAppDirPath("apps/web", ["apps/web"], { cwd: tmpDir })).toMatch(/already/i);
	});

	it("rejects parent directory of an existing app dir", () => {
		mkdirSync(join(tmpDir, "apps"), { recursive: true });
		expect(validateAppDirPath("apps", ["apps/vite"], { cwd: tmpDir })).toMatch(/overlaps/i);
	});

	it("rejects child directory of an existing app dir", () => {
		mkdirSync(join(tmpDir, "apps", "vite"), { recursive: true });
		expect(validateAppDirPath("apps/vite", ["apps"], { cwd: tmpDir })).toMatch(/overlaps/i);
	});

	it("rejects scoped dir when whole-repo app already exists", () => {
		mkdirSync(join(tmpDir, "apps", "web"), { recursive: true });
		expect(validateAppDirPath("apps/web", [""], { cwd: tmpDir })).toMatch(/whole-repo/i);
	});

	it("rejects whole-repo scope when scoped apps already exist", () => {
		expect(validateAppDirPath("", ["apps/web"], { cwd: tmpDir })).toMatch(/monorepo/i);
	});
});

// ── collectAppDirs — type-level checks ───────────────────────────────────────

describe("collectAppDirs", () => {
	it("is exported and accepts maxDirs option", () => {
		// Verify the function accepts maxDirs without TypeScript error.
		// Full interactive behaviour cannot be unit-tested without mocking
		// @clack/core's Prompt; the space-key guard and render are covered by
		// manual testing and the server-side limit enforcement.
		expect(typeof collectAppDirs).toBe("function");
		// TypeScript validates this at compile time; the runtime call would block
		// waiting for keystrokes, so we only check the type here.
		const signature: (opts?: { cwd?: string; maxDirs?: number }) => Promise<string[] | null> =
			collectAppDirs;
		expect(typeof signature).toBe("function");
	});
});

// ── promptSingleAppDir ────────────────────────────────────────────────────────

describe("promptSingleAppDir", () => {
	it("returns the entered directory", async () => {
		vi.mocked(p.text).mockResolvedValue("apps/web");
		const result = await promptSingleAppDir({ existingDirs: [] });
		expect(result).toBe("apps/web");
	});

	it("returns null on cancel", async () => {
		vi.mocked(p.text).mockResolvedValue(CANCEL as unknown as string);
		const result = await promptSingleAppDir({ existingDirs: [] });
		expect(result).toBeNull();
	});

	it("validate rejects already-added dir", async () => {
		let capturedValidate: ((val: string) => string | undefined) | undefined;
		vi.mocked(p.text).mockImplementation(async (opts) => {
			capturedValidate = (opts as { validate?: (val: string) => string | undefined }).validate;
			return "apps/new" as string;
		});
		await promptSingleAppDir({ existingDirs: ["apps/web"] });
		expect(capturedValidate?.("apps/web")).toMatch(/already/i);
	});

	it("validate rejects scoped dir when whole-repo app exists", async () => {
		let capturedValidate: ((val: string) => string | undefined) | undefined;
		vi.mocked(p.text).mockImplementation(async (opts) => {
			capturedValidate = (opts as { validate?: (val: string) => string | undefined }).validate;
			return "apps/new" as string;
		});
		await promptSingleAppDir({ existingDirs: [""] });
		expect(capturedValidate?.("apps/web")).toMatch(/whole-repo/i);
	});

	it("validate rejects whole-repo scope when scoped apps exist", async () => {
		let capturedValidate: ((val: string) => string | undefined) | undefined;
		vi.mocked(p.text).mockImplementation(async (opts) => {
			capturedValidate = (opts as { validate?: (val: string) => string | undefined }).validate;
			return "apps/new" as string;
		});
		await promptSingleAppDir({ existingDirs: ["apps/web"] });
		expect(capturedValidate?.("")).toMatch(/monorepo/i);
	});

	it("validate rejects empty string with required error (no mutual-exclusion conflict)", async () => {
		let capturedValidate: ((val: string) => string | undefined) | undefined;
		vi.mocked(p.text).mockImplementation(async (opts) => {
			capturedValidate = (opts as { validate?: (val: string) => string | undefined }).validate;
			return "apps/new" as string;
		});
		await promptSingleAppDir({ existingDirs: [] });
		expect(capturedValidate?.("")).toMatch(/required/i);
	});
});
