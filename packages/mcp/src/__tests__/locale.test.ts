import { describe, expect, it, vi } from "vitest";
import type { VocoderClient } from "../client.js";
import { runAddLocale, runRemoveLocale } from "../tools/locale.js";

// Mock detectRepoIdentity so tests don't depend on git state
vi.mock("@vocoder/plugin", () => ({
	detectRepoIdentity: () => ({ repoCanonical: "github:owner/repo", appDir: "" }),
	detectBranch: () => "main",
	detectCommitSha: () => null,
	computeFingerprint: () => "abc123",
}));

function makeClient(overrides: Partial<VocoderClient> = {}): VocoderClient {
	return {
		addLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr"] }),
		removeLocale: vi.fn().mockResolvedValue({ targetLocales: [] }),
		getConfig: vi.fn(),
		sync: vi.fn(),
		getSyncStatus: vi.fn(),
		getSnapshot: vi.fn(),
		listLocales: vi.fn(),
		...overrides,
	} as unknown as VocoderClient;
}

describe("runAddLocale", () => {
	it("returns success message with updated locale list", async () => {
		const client = makeClient({
			addLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr", "de"] }),
		});
		const result = await runAddLocale("de", client);
		expect(result).toContain("de");
		expect(result).toContain("fr, de");
	});

	it("passes locale and repoCanonical to client.addLocale", async () => {
		const client = makeClient();
		await runAddLocale("fr", client);
		expect(client.addLocale).toHaveBeenCalledWith("fr", "github:owner/repo");
	});

	it("is idempotent — succeeds even if locale already configured", async () => {
		const client = makeClient({
			addLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr"] }),
		});
		const result = await runAddLocale("fr", client);
		expect(result).toContain("fr");
	});
});

describe("runRemoveLocale", () => {
	it("returns success message with updated locale list", async () => {
		const client = makeClient({
			removeLocale: vi.fn().mockResolvedValue({ targetLocales: ["fr"] }),
		});
		const result = await runRemoveLocale("de", client);
		expect(result).toContain("de");
		expect(result).toContain("fr");
	});

	it("shows '(none)' when all locales removed", async () => {
		const client = makeClient({
			removeLocale: vi.fn().mockResolvedValue({ targetLocales: [] }),
		});
		const result = await runRemoveLocale("fr", client);
		expect(result).toContain("(none)");
	});

	it("passes locale and repoCanonical to client.removeLocale", async () => {
		const client = makeClient();
		await runRemoveLocale("fr", client);
		expect(client.removeLocale).toHaveBeenCalledWith("fr", "github:owner/repo");
	});
});
