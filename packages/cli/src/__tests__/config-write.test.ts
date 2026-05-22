import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeVocoderConfig } from "../utils/config-write.js";

describe("writeVocoderConfig", () => {
	let repoRoot: string;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "vocoder-config-write-test-"));
	});

	afterEach(() => {
		rmSync(repoRoot, { recursive: true, force: true });
	});

	describe("TypeScript project (tsconfig.json present)", () => {
		beforeEach(() => {
			writeFileSync(join(repoRoot, "tsconfig.json"), "{}", "utf-8");
		});

		it("writes vocoder.config.ts for a single-app repo", () => {
			const result = writeVocoderConfig(repoRoot, {});

			expect(result.written).toBe(true);
			expect(result.relativePath).toBe("vocoder.config.ts");
			expect(existsSync(result.path)).toBe(true);

			const content = readFileSync(result.path, "utf-8");
			expect(content).toContain("defineConfig");
			expect(content).not.toContain("targetBranches");
			expect(content).not.toContain("apps:");
		});

		it("writes vocoder.config.ts with apps[] for a monorepo", () => {
			const result = writeVocoderConfig(repoRoot, {
				appDirs: ["apps/web", "apps/admin"],
			});

			expect(result.written).toBe(true);
			expect(result.relativePath).toBe("vocoder.config.ts");

			const content = readFileSync(result.path, "utf-8");
			expect(content).not.toContain("targetBranches");
			expect(content).toContain("apps:");
			expect(content).toContain("appDir: 'apps/web'");
			expect(content).toContain("appDir: 'apps/admin'");
		});

		it("skips writing when vocoder.config.ts already exists", () => {
			const existingPath = join(repoRoot, "vocoder.config.ts");
			writeFileSync(existingPath, "// existing config", "utf-8");

			const result = writeVocoderConfig(repoRoot, {});

			expect(result.written).toBe(false);
			expect(readFileSync(existingPath, "utf-8")).toBe("// existing config");
		});

		it("returns correct path info when file already exists", () => {
			writeFileSync(join(repoRoot, "vocoder.config.ts"), "// existing", "utf-8");

			const result = writeVocoderConfig(repoRoot, {});

			expect(result.relativePath).toBe("vocoder.config.ts");
			expect(result.path).toBe(join(repoRoot, "vocoder.config.ts"));
		});
	});

	describe("JavaScript project (no tsconfig.json)", () => {
		it("writes vocoder.config.js for a single-app repo", () => {
			const result = writeVocoderConfig(repoRoot, {});

			expect(result.written).toBe(true);
			expect(result.relativePath).toBe("vocoder.config.js");
			expect(existsSync(result.path)).toBe(true);

			const content = readFileSync(result.path, "utf-8");
			expect(content).toContain("defineConfig");
			expect(content).not.toContain("apps:");
		});

		it("writes vocoder.config.js with apps[] for a monorepo", () => {
			const result = writeVocoderConfig(repoRoot, {
				appDirs: ["apps/web", "apps/admin"],
			});

			expect(result.written).toBe(true);
			expect(result.relativePath).toBe("vocoder.config.js");

			const content = readFileSync(result.path, "utf-8");
			expect(content).toContain("apps:");
			expect(content).toContain("appDir: 'apps/web'");
		});

		it("skips writing when vocoder.config.js already exists", () => {
			const existingPath = join(repoRoot, "vocoder.config.js");
			writeFileSync(existingPath, "// existing config", "utf-8");

			const result = writeVocoderConfig(repoRoot, {});

			expect(result.written).toBe(false);
			expect(readFileSync(existingPath, "utf-8")).toBe("// existing config");
		});
	});

	it("omits apps[] when appDirs is empty", () => {
		const result = writeVocoderConfig(repoRoot, { appDirs: [] });

		const content = readFileSync(result.path, "utf-8");
		expect(content).not.toContain("apps:");
	});
});
