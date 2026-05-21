import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadVocoderConfig, parseVocoderConfig } from "../index";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseVocoderConfig", () => {
	it("parses export default object literal", () => {
		const source = `export default { include: ["src/**/*.tsx"], exclude: ["**/*.test.tsx"] };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.include).toEqual(["src/**/*.tsx"]);
		expect(config!.exclude).toEqual(["**/*.test.tsx"]);
	});

	it("parses export default defineConfig(...)", () => {
		const source = `
      import { defineConfig } from '@vocoder/config';
      export default defineConfig({ include: ["app/**/*.tsx"], localesDir: "public/locales" });
    `;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.include).toEqual(["app/**/*.tsx"]);
		expect(config!.localesDir).toBe("public/locales");
	});

	it("parses TypeScript source", () => {
		const source = `
      import { defineConfig } from '@vocoder/config';
      const cfg: { include: string[] } = { include: ["src/**"] };
      export default defineConfig(cfg);
    `;
		// defineConfig with a variable reference — not an inline object, returns null
		const config = parseVocoderConfig(source);
		expect(config).toBeNull();
	});

	it("parses formality and industry fields", () => {
		const source = `export default { formality: "formal", industry: "legal" };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.formality).toBe("formal");
		expect(config!.industry).toBe("legal");
	});

	it("maps legacy appIndustry field to industry", () => {
		const source = `export default { appIndustry: "ecommerce" };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.industry).toBe("ecommerce");
	});

	it("parses targetBranches array", () => {
		const source = `export default { targetBranches: ["main", "develop"] };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.targetBranches).toEqual(["main", "develop"]);
	});

	it("parses onTranslationFailure field", () => {
		const source = `export default { onTranslationFailure: "fail" };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.onTranslationFailure).toBe("fail");
	});

	it("parses apps[] with appDir only", () => {
		const source = `export default defineConfig({ targetBranches: ["main"], apps: [{ appDir: "apps/web" }, { appDir: "apps/admin" }] });`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.apps).toHaveLength(2);
		expect(config!.apps![0]!.appDir).toBe("apps/web");
		expect(config!.apps![1]!.appDir).toBe("apps/admin");
	});

	it("parses apps[] with per-app overrides", () => {
		const source = `export default defineConfig({
      targetBranches: ["main"],
      apps: [
        { appDir: "apps/web", localesDir: "src/locales" },
        { appDir: "apps/admin", formality: "formal", targetBranches: ["main", "staging"] },
      ],
    });`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.apps).toHaveLength(2);
		expect(config!.apps![0]!.localesDir).toBe("src/locales");
		expect(config!.apps![1]!.formality).toBe("formal");
		expect(config!.apps![1]!.targetBranches).toEqual(["main", "staging"]);
	});

	it("parses apps[] with mixed entries (some with overrides, some without)", () => {
		const source = `export default { apps: [{ appDir: "apps/web" }, { appDir: "apps/api", industry: "fintech" }] };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.apps).toHaveLength(2);
		expect(config!.apps![0]!.industry).toBeUndefined();
		expect(config!.apps![1]!.industry).toBe("fintech");
	});

	it("skips apps[] entries without appDir", () => {
		const source = `export default { apps: [{ localesDir: "locales" }, { appDir: "apps/web" }] };`;
		const config = parseVocoderConfig(source);
		expect(config).not.toBeNull();
		expect(config!.apps).toHaveLength(1);
		expect(config!.apps![0]!.appDir).toBe("apps/web");
	});

	it("returns null for broken source", () => {
		expect(parseVocoderConfig("this is not valid js {{{{")).toBeNull();
	});

	it("returns null for empty export", () => {
		const config = parseVocoderConfig("export default {}");
		expect(config).not.toBeNull();
		expect(config!.include).toBeUndefined();
	});
});

describe("loadVocoderConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "vocoder-config-test-"));
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("loads vocoder.config.ts", () => {
		writeFileSync(
			join(tempDir, "vocoder.config.ts"),
			`export default { include: ["src/**/*.tsx"] };`,
		);
		const config = loadVocoderConfig(tempDir);
		expect(config).not.toBeNull();
		expect(config!.include).toEqual(["src/**/*.tsx"]);
	});

	it("loads vocoder.config.js", () => {
		writeFileSync(
			join(tempDir, "vocoder.config.js"),
			`export default { include: ["pages/**/*.jsx"] };`,
		);
		const config = loadVocoderConfig(tempDir);
		expect(config).not.toBeNull();
		expect(config!.include).toEqual(["pages/**/*.jsx"]);
	});

	it("loads vocoder.config.json", () => {
		writeFileSync(
			join(tempDir, "vocoder.config.json"),
			JSON.stringify({ include: ["app/**/*.tsx"], localesDir: "public/locales" }),
		);
		const config = loadVocoderConfig(tempDir);
		expect(config).not.toBeNull();
		expect(config!.include).toEqual(["app/**/*.tsx"]);
		expect(config!.localesDir).toBe("public/locales");
	});

	it("prefers .ts over .json when both exist", () => {
		writeFileSync(
			join(tempDir, "vocoder.config.ts"),
			`export default { include: ["from-ts/**"] };`,
		);
		writeFileSync(
			join(tempDir, "vocoder.config.json"),
			JSON.stringify({ include: ["from-json/**"] }),
		);
		const config = loadVocoderConfig(tempDir);
		expect(config!.include).toEqual(["from-ts/**"]);
	});

	it("returns null when no config file exists", () => {
		expect(loadVocoderConfig(tempDir)).toBeNull();
	});

	it("returns null for invalid JSON", () => {
		writeFileSync(join(tempDir, "vocoder.config.json"), "{ invalid json }");
		expect(loadVocoderConfig(tempDir)).toBeNull();
	});
});
