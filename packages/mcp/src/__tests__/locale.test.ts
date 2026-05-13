import { describe, expect, it, vi } from "vitest";
import type { VocoderAPI } from "@vocoder/cli/lib";
import { runAddLocale, runRemoveLocale } from "../tools/locales.js";

function makeClient(overrides: Partial<VocoderAPI> = {}): VocoderAPI {
	return {
		addLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr"] }),
		removeLocale: vi.fn().mockResolvedValue({ targetLocales: [] }),
		...overrides,
	} as unknown as VocoderAPI;
}

describe("runAddLocale", () => {
	it("returns success message with updated locale list", async () => {
		const api = makeClient({
			addLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr", "de"] }),
		});
		const result = await runAddLocale("de", api);
		expect(result).toContain("de");
		expect(result).toContain("fr, de");
	});

	it("passes locale to api.addLocale", async () => {
		const api = makeClient();
		await runAddLocale("fr", api);
		expect(api.addLocale).toHaveBeenCalledWith("fr");
	});

	it("is idempotent — succeeds even if locale already configured", async () => {
		const api = makeClient({
			addLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr"] }),
		});
		const result = await runAddLocale("fr", api);
		expect(result).toContain("fr");
	});
});

describe("runRemoveLocale", () => {
	it("returns success message with updated locale list", async () => {
		const api = makeClient({
			removeLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr"] }),
		});
		const result = await runRemoveLocale("de", api);
		expect(result).toContain("de");
		expect(result).toContain("fr");
	});

	it("shows '(none)' when all locales removed", async () => {
		const api = makeClient({
			removeLocale: vi.fn().mockResolvedValue({ targetLocales: [] }),
		});
		const result = await runRemoveLocale("fr", api);
		expect(result).toContain("(none)");
	});

	it("passes locale to api.removeLocale", async () => {
		const api = makeClient();
		await runRemoveLocale("fr", api);
		expect(api.removeLocale).toHaveBeenCalledWith("fr");
	});
});
