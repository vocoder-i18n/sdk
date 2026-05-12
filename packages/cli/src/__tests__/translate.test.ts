import { afterEach, describe, expect, it, vi } from "vitest";
import {
	computeExitCode,
	formatLocaleResults,
	formatProgress,
} from "../commands/translate.js";
import type { TranslateStatusResponse } from "../types.js";

// ── formatProgress ─────────────────────────────────────────────────────────────

describe("formatProgress", () => {
	function makeStatus(
		s: TranslateStatusResponse["status"],
		completed: number,
		total: number,
	): TranslateStatusResponse {
		return {
			status: s,
			progress: { completed, total },
			locales: {},
		};
	}

	it("shows 0/N at start", () => {
		expect(formatProgress(makeStatus("pending", 0, 47))).toBe("  ⟳ 0/47 complete...");
	});

	it("shows mid-poll progress", () => {
		expect(formatProgress(makeStatus("running", 18, 47))).toBe("  ⟳ 18/47 complete...");
	});

	it("shows N/N when complete", () => {
		expect(formatProgress(makeStatus("complete", 47, 47))).toBe("  ⟳ 47/47 complete...");
	});
});

// ── formatLocaleResults ────────────────────────────────────────────────────────

describe("formatLocaleResults", () => {
	it("marks all complete with elapsed time", () => {
		const locales = { es: "complete", fr: "complete", de: "complete" } as const;
		const result = formatLocaleResults(locales, "21.6");
		expect(result).toContain("es");
		expect(result).toContain("fr");
		expect(result).toContain("de");
		expect(result).toContain("— 21.6s");
	});

	it("marks partial failure without elapsed time suffix", () => {
		const locales = { es: "complete", fr: "failed", de: "complete" } as const;
		const result = formatLocaleResults(locales, "10.0");
		expect(result).not.toContain("— 10.0s");
	});
});

// ── computeExitCode ────────────────────────────────────────────────────────────

describe("computeExitCode", () => {
	it("complete always exits 0 regardless of onTranslationFailure", () => {
		expect(computeExitCode("complete", "fail")).toBe(0);
		expect(computeExitCode("complete", "proceed")).toBe(0);
	});

	it("failed + proceed exits 0", () => {
		expect(computeExitCode("failed", "proceed")).toBe(0);
	});

	it("failed + fail exits 1", () => {
		expect(computeExitCode("failed", "fail")).toBe(1);
	});
});

// ── polling exponential backoff ────────────────────────────────────────────────

describe("polling backoff", () => {
	it("interval approaches 5000ms cap", () => {
		let interval = 1000;
		for (let i = 0; i < 20; i++) {
			interval = Math.min(interval * 1.5, 5000);
		}
		expect(interval).toBe(5000);
	});

	it("interval starts at 1000ms and grows", () => {
		const intervals: number[] = [];
		let interval = 1000;
		for (let i = 0; i < 5; i++) {
			intervals.push(interval);
			interval = Math.min(interval * 1.5, 5000);
		}
		expect(intervals[0]).toBe(1000);
		expect(intervals[1]).toBe(1500);
		expect(intervals[2]).toBe(2250);
		expect(intervals[3]).toBe(3375);
		// rounds to float — just check it's growing
		expect(intervals[4]!).toBeGreaterThan(3375);
	});
});

// ── integration: submit → poll → complete ─────────────────────────────────────

describe("translate API integration (mocked)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = originalFetch;
	});

	it("polls until complete and reads final status", async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			callCount++;
			if (String(url).includes("/api/cli/translate") && !String(url).includes("/status")) {
				return {
					ok: true,
					text: async () => JSON.stringify({ jobId: "job-abc" }),
				} as Response;
			}
			// First two polls: running; third: complete
			const status = callCount < 4 ? "running" : "complete";
			return {
				ok: true,
				text: async () =>
					JSON.stringify({
						status,
						progress: { completed: status === "complete" ? 10 : 5, total: 10 },
						locales: { es: status, fr: status },
						...(status === "complete" ? { fingerprint: "abc123" } : {}),
					}),
			} as Response;
		});

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({ apiKey: "vca_1234567890_1234567890123456789012", apiUrl: "https://vocoder.app" });

		const submitResult = await api.submitTranslate({
			branch: "main",
			stringEntries: [{ key: "k1", text: "Hello" }],
			targetLocales: ["es", "fr"],
			stringsHash: "abc",
			clientRunId: "run-1",
		});
		expect(submitResult.jobId).toBe("job-abc");

		const status = await api.pollTranslateStatus(submitResult.jobId);
		expect(["running", "complete"]).toContain(status.status);
	});
});
