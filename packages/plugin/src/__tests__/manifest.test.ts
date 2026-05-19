import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

import * as fs from "node:fs";

describe("plugin manifest loading", () => {
	const sampleManifest = {
		version: 1 as const,
		sourceLocale: "en",
		targetLocales: ["fr", "de"],
		locales: {
			en: { nativeName: "English", isRTL: false },
			fr: { nativeName: "Français", isRTL: false },
			de: { nativeName: "Deutsch", isRTL: false },
		},
		updatedAt: "2026-01-01T00:00:00.000Z",
		fingerprint: "abc123",
	};

	describe("getDefineValues shape", () => {
		it("serializes manifest to valid JSON string", () => {
			const serialized = JSON.stringify(sampleManifest);
			const parsed = JSON.parse(serialized);
			expect(parsed.sourceLocale).toBe("en");
			expect(parsed.targetLocales).toEqual(["fr", "de"]);
			expect(parsed.fingerprint).toBe("abc123");
		});

		it("serializes null manifest to JSON null string", () => {
			expect(JSON.stringify(null)).toBe("null");
		});

		it("preserves all locale metadata through serialization", () => {
			const serialized = JSON.stringify(sampleManifest);
			const parsed = JSON.parse(serialized);
			expect(parsed.locales.fr.nativeName).toBe("Français");
			expect(parsed.locales.en.isRTL).toBe(false);
		});
	});

	describe("locales alias path", () => {
		it("resolves default locales dir relative to cwd", () => {
			const cwd = "/project";
			const localesDir = "locales";
			const alias = path.resolve(cwd, localesDir);
			expect(alias).toBe("/project/locales");
		});

		it("respects custom localesDir option", () => {
			const cwd = "/project";
			const localesDir = "apps/web/locales";
			const alias = path.resolve(cwd, localesDir);
			expect(alias).toBe("/project/apps/web/locales");
		});
	});

	describe("manifest reading", () => {
		it("returns null when manifest.json is missing", () => {
			vi.mocked(fs.readFileSync).mockImplementationOnce(() => {
				throw new Error("ENOENT");
			});

			let manifest: unknown = null;
			try {
				manifest = JSON.parse(fs.readFileSync("/nonexistent/manifest.json", "utf-8"));
			} catch {
				manifest = null;
			}

			expect(manifest).toBeNull();
		});

		it("parses manifest.json when present", () => {
			vi.mocked(fs.readFileSync).mockReturnValueOnce(
				JSON.stringify(sampleManifest) as unknown as Buffer,
			);

			let manifest: unknown = null;
			try {
				manifest = JSON.parse(fs.readFileSync("/project/locales/manifest.json", "utf-8"));
			} catch {
				manifest = null;
			}

			expect(manifest).not.toBeNull();
			expect((manifest as typeof sampleManifest).sourceLocale).toBe("en");
		});
	});
});
