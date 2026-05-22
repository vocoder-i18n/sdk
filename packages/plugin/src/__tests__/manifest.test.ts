import { describe, expect, it, vi, beforeEach } from "vitest";
import * as path from "node:path";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, existsSync: vi.fn(actual.existsSync) };
});

vi.mock("../env", () => ({ loadEnvFile: vi.fn() }));
vi.mock("@vocoder/extractor", () => ({ transformMsgProps: vi.fn(() => ({ changed: false, code: "" })) }));

import * as fs from "node:fs";
import { unplugin } from "../index";

function createPlugin(options = {}) {
	// unplugin.raw returns the raw plugin factory used by Vite/Rollup
	return unplugin.raw(options, { framework: "vite" as never });
}

describe("plugin resolveId", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns real path for locale-loader when loader.js exists", () => {
		vi.mocked(fs.existsSync).mockImplementation((p) =>
			String(p).endsWith("loader.js"),
		);

		const plugin = createPlugin();
		const result = plugin.resolveId.handler?.call({} as never,"@vocoder/react/locale-loader", undefined, {} as never);

		expect(result).toBe(path.resolve(process.cwd(), "locales", "loader.js"));
	});

	it("returns null for locale-loader when loader.js is absent", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const plugin = createPlugin();
		const result = plugin.resolveId.handler?.call({} as never,"@vocoder/react/locale-loader", undefined, {} as never);

		expect(result).toBeNull();
	});

	it("returns real path for manifest-loader when manifest.json exists", () => {
		vi.mocked(fs.existsSync).mockImplementation((p) =>
			String(p).endsWith("manifest.json"),
		);

		const plugin = createPlugin();
		const result = plugin.resolveId.handler?.call({} as never,"@vocoder/react/manifest-loader", undefined, {} as never);

		expect(result).toBe(path.resolve(process.cwd(), "locales", "manifest.json"));
	});

	it("returns null for manifest-loader when manifest.json is absent", () => {
		vi.mocked(fs.existsSync).mockReturnValue(false);

		const plugin = createPlugin();
		const result = plugin.resolveId.handler?.call({} as never,"@vocoder/react/manifest-loader", undefined, {} as never);

		expect(result).toBeNull();
	});

	it("returns null for unrelated module IDs", () => {
		vi.mocked(fs.existsSync).mockReturnValue(true);

		const plugin = createPlugin();
		const result = plugin.resolveId.handler?.call({} as never,"some-other-package", undefined, {} as never);

		expect(result).toBeNull();
	});

	describe("custom localesDir option", () => {
		it("resolves locale-loader using custom localesDir", () => {
			vi.mocked(fs.existsSync).mockImplementation((p) =>
				String(p).endsWith("loader.js"),
			);

			const plugin = createPlugin({ localesDir: "src/i18n" });
			const result = plugin.resolveId.handler?.call({} as never,"@vocoder/react/locale-loader", undefined, {} as never);

			expect(result).toBe(path.resolve(process.cwd(), "src/i18n", "loader.js"));
		});

		it("resolves manifest-loader using custom localesDir", () => {
			vi.mocked(fs.existsSync).mockImplementation((p) =>
				String(p).endsWith("manifest.json"),
			);

			const plugin = createPlugin({ localesDir: "src/i18n" });
			const result = plugin.resolveId.handler?.call({} as never,"@vocoder/react/manifest-loader", undefined, {} as never);

			expect(result).toBe(path.resolve(process.cwd(), "src/i18n", "manifest.json"));
		});
	});
});

describe("plugin alias paths", () => {
	it("default localesDir resolves to cwd/locales", () => {
		const alias = path.resolve(process.cwd(), "locales", "loader.js");
		expect(alias).toBe(path.join(process.cwd(), "locales", "loader.js"));
	});

	it("custom localesDir resolves correctly", () => {
		const alias = path.resolve("/project", "apps/web/locales", "manifest.json");
		expect(alias).toBe("/project/apps/web/locales/manifest.json");
	});
});
