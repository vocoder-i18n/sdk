import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeLocaleFileTree } from "../commands/pull.js";

// ── writeLocaleFileTree ───────────────────────────────────────────────────────

describe("writeLocaleFileTree", () => {
	let tmpDir: string;

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	function makeTmpDir(): string {
		const dir = join(tmpdir(), `pull-test-${Date.now()}`);
		mkdirSync(dir, { recursive: true });
		tmpDir = dir;
		return dir;
	}

	it("writes each file from the tree to disk", () => {
		const root = makeTmpDir();
		const tree: Record<string, string> = {
			"locales/manifest.json": '{"version":1}\n',
			"locales/en.json": '{"1abc":"Hello"}\n',
			"locales/es.json": '{"1abc":"Hola"}\n',
		};

		writeLocaleFileTree(tree, root);

		for (const [relativePath, content] of Object.entries(tree)) {
			const filePath = join(root, relativePath);
			expect(readFileSync(filePath, "utf-8")).toBe(content);
		}
	});

	it("creates nested directories recursively", () => {
		const root = makeTmpDir();
		writeLocaleFileTree({ "locales/deep/nested/en.json": '{"k":"v"}\n' }, root);
		expect(readFileSync(join(root, "locales/deep/nested/en.json"), "utf-8")).toBe('{"k":"v"}\n');
	});

	it("overwrites existing files", () => {
		const root = makeTmpDir();
		mkdirSync(join(root, "locales"), { recursive: true });
		const filePath = join(root, "locales/en.json");
		writeFileSync(filePath, '{"old":"value"}\n', "utf-8");

		writeLocaleFileTree({ "locales/en.json": '{"new":"value"}\n' }, root);

		expect(readFileSync(filePath, "utf-8")).toBe('{"new":"value"}\n');
	});

	it("writes multiple locale files and manifest", () => {
		const root = makeTmpDir();
		const tree: Record<string, string> = {
			"locales/manifest.json": '{"version":1,"sourceLocale":"en","targetLocales":["es","fr"]}\n',
			"locales/en.json": '{"key1":"Source text"}\n',
			"locales/es.json": '{"key1":"Texto fuente"}\n',
			"locales/fr.json": '{"key1":"Texte source"}\n',
		};

		writeLocaleFileTree(tree, root);

		const localesDir = join(root, "locales");
		const files = readdirSync(localesDir).sort();
		expect(files).toEqual(["en.json", "es.json", "fr.json", "manifest.json"]);
	});
});

// ── VocoderAPI.getLocaleFiles (mocked fetch) ──────────────────────────────────

describe("VocoderAPI.getLocaleFiles", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = originalFetch;
	});

	it("returns FOUND with apps array on success", async () => {
		const localeFileTree = {
			"locales/manifest.json": '{"version":1}\n',
			"locales/en.json": '{"k":"v"}\n',
		};
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({
					status: "FOUND",
					branch: "main",
					apps: [{ appDir: "", localeFileTree }],
				}),
		} as Response);

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({
			apiKey: "vcp_aB3xY9Zk_testrandombytes123456",
			apiUrl: "https://vocoder.app",
		});
		const result = await api.getLocaleFiles({ branch: "main" });

		expect(result.status).toBe("FOUND");
		expect(result.apps).toHaveLength(1);
		expect(result.apps[0].localeFileTree).toEqual(localeFileTree);
	});

	it("returns NOT_FOUND when no translations exist", async () => {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({ status: "NOT_FOUND", branch: "main", apps: [] }),
		} as Response);

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({
			apiKey: "vcp_aB3xY9Zk_testrandombytes123456",
			apiUrl: "https://vocoder.app",
		});
		const result = await api.getLocaleFiles({ branch: "main" });

		expect(result.status).toBe("NOT_FOUND");
		expect(result.apps).toHaveLength(0);
	});

	it("sends only branch in query params", async () => {
		const mockFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			text: async () =>
				JSON.stringify({ status: "NOT_FOUND", branch: "feat/x", apps: [] }),
		} as Response);
		globalThis.fetch = mockFetch;

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({
			apiKey: "vcp_aB3xY9Zk_testrandombytes123456",
			apiUrl: "https://vocoder.app",
		});
		await api.getLocaleFiles({ branch: "feat/x" });

		const [url] = mockFetch.mock.calls[0] as [string];
		expect(url).toContain("/api/project/translations/pull");
		expect(url).toContain("branch=feat%2Fx");
		expect(url).not.toContain("appDir");
	});
});
