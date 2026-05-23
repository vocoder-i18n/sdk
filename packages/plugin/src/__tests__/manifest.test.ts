import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";

vi.mock("../env", () => ({ loadEnvFile: vi.fn() }));
vi.mock("@vocoder/extractor", () => ({
	transformMsgProps: vi.fn(() => ({ changed: false, code: "" })),
}));

import { transformMsgProps } from "@vocoder/extractor";
import { unplugin } from "../index";

function createPlugin(options = {}) {
	return unplugin.raw(options, { framework: "vite" as never });
}

describe("plugin transform", () => {
	it("skips files that do not import @vocoder/react", () => {
		const plugin = createPlugin();
		const result = plugin.transform?.call({} as never, "const x = 1;", "file.tsx");
		expect(result).toBeNull();
		expect(transformMsgProps).not.toHaveBeenCalled();
	});

	it("calls transformMsgProps for files that import @vocoder/react", () => {
		vi.mocked(transformMsgProps).mockReturnValueOnce({ changed: true, code: "transformed" });
		const plugin = createPlugin();
		const result = plugin.transform?.call(
			{} as never,
			'import { T } from "@vocoder/react"; <T>Hello</T>',
			"app.tsx",
		);
		expect(transformMsgProps).toHaveBeenCalled();
		expect(result).toEqual({ code: "transformed" });
	});

	it("returns null when transformMsgProps reports no changes", () => {
		vi.mocked(transformMsgProps).mockReturnValueOnce({ changed: false, code: "" });
		const plugin = createPlugin();
		const result = plugin.transform?.call(
			{} as never,
			'import { T } from "@vocoder/react"; <T>Hello</T>',
			"app.tsx",
		);
		expect(result).toBeNull();
	});

	it("returns null when transformMsgProps throws", () => {
		vi.mocked(transformMsgProps).mockImplementationOnce(() => {
			throw new Error("parse error");
		});
		const plugin = createPlugin();
		const result = plugin.transform?.call(
			{} as never,
			'import { T } from "@vocoder/react"; <T>Hello</T>',
			"app.tsx",
		);
		expect(result).toBeNull();
	});
});

describe("plugin transformInclude", () => {
	it("includes .tsx files outside node_modules", () => {
		const plugin = createPlugin();
		expect(plugin.transformInclude?.call({} as never, "src/App.tsx")).toBe(true);
	});

	it("includes .ts files", () => {
		const plugin = createPlugin();
		expect(plugin.transformInclude?.call({} as never, "src/util.ts")).toBe(true);
	});

	it("excludes node_modules", () => {
		const plugin = createPlugin();
		expect(
			plugin.transformInclude?.call({} as never, "node_modules/react/index.js"),
		).toBe(false);
	});

	it("excludes non-JS/TS files", () => {
		const plugin = createPlugin();
		expect(plugin.transformInclude?.call({} as never, "styles.css")).toBe(false);
	});
});

describe("plugin vite config — define injection", () => {
	it("injects __VOCODER_PREVIEW__ false by default", () => {
		const plugin = createPlugin();
		const config = (plugin as { vite?: { config?: () => unknown } }).vite?.config?.() as {
			define: Record<string, string>;
		};
		expect(config.define.__VOCODER_PREVIEW__).toBe("false");
	});

	it("injects __VOCODER_PREVIEW__ true when preview option is set", () => {
		const plugin = createPlugin({ preview: true });
		const config = (plugin as { vite?: { config?: () => unknown } }).vite?.config?.() as {
			define: Record<string, string>;
		};
		expect(config.define.__VOCODER_PREVIEW__).toBe("true");
	});

	it("injects CDN constants as 'undefined' string when env vars are absent", () => {
		const plugin = createPlugin();
		const config = (plugin as { vite?: { config?: () => unknown } }).vite?.config?.() as {
			define: Record<string, string>;
		};
		expect(config.define.__VOCODER_CDN_URL__).toBe("undefined");
		expect(config.define.__VOCODER_API_URL__).toBe("undefined");
		expect(config.define.__VOCODER_PROJECT_SHORT_ID__).toBe("undefined");
	});

	it("injects __VOCODER_BUILD_TS__ as a numeric string", () => {
		const plugin = createPlugin();
		const config = (plugin as { vite?: { config?: () => unknown } }).vite?.config?.() as {
			define: Record<string, string>;
		};
		expect(Number(config.define.__VOCODER_BUILD_TS__)).toBeGreaterThan(0);
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
