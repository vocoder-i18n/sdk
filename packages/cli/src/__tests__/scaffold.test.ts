import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeAppConfigs } from "../utils/scaffold.js";

vi.mock("@clack/prompts", () => ({
	log: {
		success: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
	},
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
}));

vi.mock("../utils/detect-local.js", () => ({
	detectLocalEcosystem: vi.fn(() => ({
		ecosystem: null,
		framework: null,
		packageManager: "npm",
		isTypeScript: true,
	})),
	getPackagesToInstall: vi.fn(() => ({ devPackages: [], runtimePackages: [] })),
	buildInstallCommand: vi.fn(),
}));

import * as p from "@clack/prompts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "vocoder-scaffold-test-"));
	vi.clearAllMocks();
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ── writeAppConfigs ───────────────────────────────────────────────────────────

describe("writeAppConfigs", () => {
	it("writes a single TypeScript config for a single-app project", () => {
		const apps = [{ appDir: "", appId: "app-abc" }];
		writeAppConfigs(apps, ["main"], true, tmpDir);
		expect(existsSync(join(tmpDir, "vocoder.config.ts"))).toBe(true);
		expect(p.log.success).toHaveBeenCalledWith(
			expect.stringContaining("vocoder.config.ts"),
		);
	});

	it("writes a JS config when useTypeScript is false", () => {
		const apps = [{ appDir: "", appId: "app-abc" }];
		writeAppConfigs(apps, ["main"], false, tmpDir);
		expect(existsSync(join(tmpDir, "vocoder.config.js"))).toBe(true);
	});

	it("writes per-directory configs for a monorepo", () => {
		mkdirSync(join(tmpDir, "apps/web"), { recursive: true });
		mkdirSync(join(tmpDir, "apps/api"), { recursive: true });
		const apps = [
			{ appDir: "apps/web", appId: "app-web" },
			{ appDir: "apps/api", appId: "app-api" },
		];
		writeAppConfigs(apps, ["main"], true, tmpDir);
		expect(existsSync(join(tmpDir, "apps/web/vocoder.config.ts"))).toBe(true);
		expect(existsSync(join(tmpDir, "apps/api/vocoder.config.ts"))).toBe(true);
	});

	it("warns when config cannot be written", () => {
		// appDir that doesn't exist (write-config returns falsy, no existing config)
		const apps = [{ appDir: "nonexistent-dir", appId: "app-xyz" }];
		writeAppConfigs(apps, ["main"], true, tmpDir);
		expect(p.log.warn).toHaveBeenCalledWith(
			expect.stringContaining("vocoder.config.ts"),
		);
	});
});
