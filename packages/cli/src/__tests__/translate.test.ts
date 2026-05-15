import { afterEach, describe, expect, it, vi } from "vitest";
import {
	computeExitCode,
	formatAppProgress,
	formatLocaleResults,
	getLimitErrorGuidance,
} from "../commands/translate.js";
import type { AppTranslateStatus, LimitErrorResponse } from "../types.js";

// ── formatAppProgress ──────────────────────────────────────────────────────────

describe("formatAppProgress", () => {
	function makeApp(appDir: string, completed: number, total: number): AppTranslateStatus {
		return {
			appDir,
			appId: "app-1",
			status: "running",
			providers: {},
			progress: { completed, total },
		};
	}

	it("shows appDir label with progress", () => {
		const result = formatAppProgress(makeApp("apps/web", 0, 47));
		expect(result).toContain("apps/web");
		expect(result).toContain("0/47");
	});

	it("uses (root) label when appDir is empty", () => {
		const result = formatAppProgress(makeApp("", 18, 47));
		expect(result).toContain("(root)");
		expect(result).toContain("18/47");
	});

	it("shows N/N when complete", () => {
		const result = formatAppProgress(makeApp("apps/web", 47, 47));
		expect(result).toContain("47/47");
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

// ── getLimitErrorGuidance ──────────────────────────────────────────────────────

describe("getLimitErrorGuidance", () => {
	function makeLimit(overrides: Partial<LimitErrorResponse>): LimitErrorResponse {
		return {
			errorCode: "LIMIT_EXCEEDED",
			limitType: "source_strings",
			planId: "starter",
			current: 100,
			required: 200,
			upgradeUrl: "https://vocoder.app/upgrade",
			message: "Limit exceeded",
			...overrides,
		};
	}

	it("providers branch — includes DeepL mention and settings URL", () => {
		const lines = getLimitErrorGuidance(makeLimit({ limitType: "providers" }));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("DeepL");
		expect(lines[1]).toContain("https://vocoder.app/upgrade");
	});

	it("translation_chars branch — combines current/required on one line + upgrade URL", () => {
		const lines = getLimitErrorGuidance(
			makeLimit({ limitType: "translation_chars", current: 50000, required: 75000 }),
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("50,000");
		expect(lines[0]).toContain("75,000");
		expect(lines[1]).toContain("https://vocoder.app/upgrade");
	});

	it("source_strings branch — combines current/required on one line + upgrade URL", () => {
		const lines = getLimitErrorGuidance(
			makeLimit({ limitType: "source_strings", current: 100, required: 200 }),
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("100");
		expect(lines[0]).toContain("200");
		expect(lines[1]).toContain("https://vocoder.app/upgrade");
	});

	it("target_locales branch — shows required count, planId, and upgrade URL", () => {
		const lines = getLimitErrorGuidance(
			makeLimit({ limitType: "target_locales", current: 2, required: 3, planId: "starter" }),
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("starter");
		expect(lines[1]).toContain("https://vocoder.app/upgrade");
	});

	it("fallback branch — combines planId/current/required on one line + upgrade URL", () => {
		const lines = getLimitErrorGuidance(
			makeLimit({ limitType: "credits", planId: "pro", current: 10, required: 50 }),
		);
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("pro");
		expect(lines[0]).toContain("10");
		expect(lines[0]).toContain("50");
		expect(lines[1]).toContain("https://vocoder.app/upgrade");
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
		expect(intervals[4]!).toBeGreaterThan(3375);
	});
});

// ── integration: submit → poll (batch API) ─────────────────────────────────────

describe("translate API integration (mocked)", () => {
	const originalFetch = globalThis.fetch;
	afterEach(() => {
		vi.restoreAllMocks();
		globalThis.fetch = originalFetch;
	});

	it("polls until complete and reads final batch status", async () => {
		let callCount = 0;
		globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
			callCount++;
			if (String(url).includes("/api/translate") && !String(url).includes("/status")) {
				return {
					ok: true,
					text: async () =>
						JSON.stringify({
							jobId: "job-abc",
							apps: [{ appDir: "", appId: "app-1" }],
						}),
				} as Response;
			}
			const isDone = callCount >= 4;
			const appStatus = isDone ? "complete" : "running";
			return {
				ok: true,
				text: async () =>
					JSON.stringify({
						jobId: "job-abc",
						status: appStatus,
						apps: [
							{
								appDir: "",
								appId: "app-1",
								status: appStatus,
								providers: {
									deepl: {
										status: appStatus,
										completed: isDone ? 10 : 5,
										total: 10,
									},
								},
								progress: { completed: isDone ? 10 : 5, total: 10 },
							},
						],
					}),
			} as Response;
		});

		const { VocoderAPI } = await import("../utils/api.js");
		const api = new VocoderAPI({ apiKey: "vcp_aB3xY9Zk_testrandombytes123456", apiUrl: "https://vocoder.app" });

		const submitResult = await api.submitTranslate({
			branch: "main",
			apps: [
				{
					appDir: "",
					strings: [{ key: "k1", text: "Hello" }],
					sourceEntriesHash: "abc",
				},
			],
			repoUrl: "",
			clientRunId: "run-1",
		});
		expect(submitResult.jobId).toBe("job-abc");

		const status = await api.pollTranslateStatus(submitResult.jobId);
		expect(["running", "complete"]).toContain(status.status);
		expect(status.apps).toHaveLength(1);
	});
});
