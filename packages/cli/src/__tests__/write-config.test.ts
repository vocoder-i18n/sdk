import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findExistingConfig, writeVocoderConfig } from "../utils/write-config.js";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "vocoder-test-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("writeVocoderConfig", () => {
	it("writes vocoder.config.ts to cwd by default", () => {
		const written = writeVocoderConfig({ cwd: tmpDir });
		expect(written).toBe("vocoder.config.ts");
		const content = readFileSync(join(tmpDir, "vocoder.config.ts"), "utf-8");
		expect(content).toContain("from '@vocoder/config'");
		expect(content).toContain("defineConfig");
	});

	it("writes vocoder.config.js when useTypeScript is false", () => {
		const written = writeVocoderConfig({ cwd: tmpDir, useTypeScript: false });
		expect(written).toBe("vocoder.config.js");
	});

	it("includes appId as first field when provided", () => {
		writeVocoderConfig({ cwd: tmpDir, appId: "cm4abc123" });
		const content = readFileSync(join(tmpDir, "vocoder.config.ts"), "utf-8");
		expect(content).toContain("appId: 'cm4abc123'");
		// appId must appear before targetBranches
		const appIdPos = content.indexOf("appId:");
		const branchesPos = content.indexOf("targetBranches:");
		expect(appIdPos).toBeLessThan(branchesPos);
	});

	it("omits appId line when not provided", () => {
		writeVocoderConfig({ cwd: tmpDir });
		const content = readFileSync(join(tmpDir, "vocoder.config.ts"), "utf-8");
		expect(content).not.toContain("appId:");
	});

	it("writes targetBranches correctly", () => {
		writeVocoderConfig({ cwd: tmpDir, targetBranches: ["main", "develop"] });
		const content = readFileSync(join(tmpDir, "vocoder.config.ts"), "utf-8");
		expect(content).toContain("'main', 'develop'");
	});

	it("returns null and skips write when config already exists", () => {
		writeFileSync(join(tmpDir, "vocoder.config.ts"), "existing", "utf-8");
		const result = writeVocoderConfig({ cwd: tmpDir });
		expect(result).toBeNull();
		// File unchanged
		expect(readFileSync(join(tmpDir, "vocoder.config.ts"), "utf-8")).toBe("existing");
	});

	it("returns null when cwd is not writable", () => {
		const result = writeVocoderConfig({ cwd: "/nonexistent/path" });
		expect(result).toBeNull();
	});
});

describe("findExistingConfig", () => {
	it("finds vocoder.config.ts", () => {
		writeFileSync(join(tmpDir, "vocoder.config.ts"), "", "utf-8");
		expect(findExistingConfig(tmpDir)).toBe(join(tmpDir, "vocoder.config.ts"));
	});

	it("finds vocoder.config.js", () => {
		writeFileSync(join(tmpDir, "vocoder.config.js"), "", "utf-8");
		expect(findExistingConfig(tmpDir)).toBe(join(tmpDir, "vocoder.config.js"));
	});

	it("finds vocoder.config.json", () => {
		writeFileSync(join(tmpDir, "vocoder.config.json"), "", "utf-8");
		expect(findExistingConfig(tmpDir)).toBe(join(tmpDir, "vocoder.config.json"));
	});

	it("returns null when no config exists", () => {
		expect(findExistingConfig(tmpDir)).toBeNull();
	});

	it("prefers .ts over .js", () => {
		writeFileSync(join(tmpDir, "vocoder.config.ts"), "", "utf-8");
		writeFileSync(join(tmpDir, "vocoder.config.js"), "", "utf-8");
		expect(findExistingConfig(tmpDir)).toBe(join(tmpDir, "vocoder.config.ts"));
	});
});
