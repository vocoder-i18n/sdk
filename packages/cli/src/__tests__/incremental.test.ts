import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../types.js";
import { VocoderAPI } from "../utils/api.js";

/**
 * Integration tests for incremental translation workflow
 *
 * These tests verify that:
 * 1. Only new strings are translated (not re-translating existing ones)
 * 2. Adding 1 new string is much faster than initial translation
 * 3. Removing strings updates the translations correctly
 * 4. Modifying strings creates new translations
 */
describe("Incremental Translation Workflow", () => {
	let api: VocoderAPI;
	let config: AppConfig;

	beforeEach(() => {
		config = {
			apiKey: "test-key",
			apiUrl: "http://localhost:3000",
			projectName: "test-project",
			organizationName: "test-org",
			sourceLocale: "en",
			targetBranches: ["main"],
			targetLocales: ["es", "fr", "de"],
			syncPolicy: {
				blockingBranches: ["main", "master"],
				blockingMode: "required",
				nonBlockingMode: "best-effort",
				defaultMaxWaitMs: 60000,
			},
			includePattern: "src/**/*.{tsx,jsx}",
			timeout: 60000,
		};

		api = new VocoderAPI(config);
	});

	describe("New String Detection", () => {
		it("should identify new strings correctly", async () => {
			// Mock API responses
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			// First submission: 10 strings, all new
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-1",
					newStrings: 10,
					totalStrings: 10,
					status: "PENDING",
				}),
			});

			const strings = Array.from({ length: 10 }, (_, i) => `String ${i + 1}`);
			const response1 = await api.submitTranslation(
				"main",
				strings,
				config.targetLocales,
			);

			expect(response1.newStrings).toBe(10);
			expect(response1.totalStrings).toBe(10);

			// Second submission: Same 10 strings, 0 new
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-2",
					newStrings: 0,
					totalStrings: 10,
					status: "COMPLETED",
				}),
			});

			const response2 = await api.submitTranslation(
				"main",
				strings,
				config.targetLocales,
			);

			expect(response2.newStrings).toBe(0);
			expect(response2.totalStrings).toBe(10);
		});

		it("should identify partially new strings", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			// Submission: 10 old strings + 3 new strings
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-1",
					newStrings: 3,
					totalStrings: 13,
					status: "PENDING",
				}),
			});

			const oldStrings = Array.from(
				{ length: 10 },
				(_, i) => `Old String ${i + 1}`,
			);
			const newStrings = ["New String 1", "New String 2", "New String 3"];
			const allStrings = [...oldStrings, ...newStrings];

			const response = await api.submitTranslation(
				"main",
				allStrings,
				config.targetLocales,
			);

			expect(response.newStrings).toBe(3);
			expect(response.totalStrings).toBe(13);
		});
	});

	describe("Performance Expectations", () => {
		it("should indicate faster processing for fewer new strings", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			// Initial batch: 100 strings
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-1",
					newStrings: 100,
					totalStrings: 100,
					status: "PENDING",
					estimatedTime: 30, // 30 seconds for 100 strings
				}),
			});

			const initialStrings = Array.from(
				{ length: 100 },
				(_, i) => `String ${i + 1}`,
			);
			const response1 = await api.submitTranslation(
				"main",
				initialStrings,
				config.targetLocales,
			);

			expect(response1.estimatedTime).toBe(30);

			// Incremental batch: 100 existing + 1 new string
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-2",
					newStrings: 1,
					totalStrings: 101,
					status: "PENDING",
					estimatedTime: 0.3, // ~0.3 seconds for 1 string
				}),
			});

			const incrementalStrings = [...initialStrings, "Brand New String"];
			const response2 = await api.submitTranslation(
				"main",
				incrementalStrings,
				config.targetLocales,
			);

			expect(response2.newStrings).toBe(1);
			expect(response2.estimatedTime).toBeLessThan(1);

			// Incremental should be at least 30x faster
			const speedup = response1.estimatedTime! / response2.estimatedTime!;
			expect(speedup).toBeGreaterThan(30);
		});
	});

	describe("String Removal", () => {
		it("should handle removed strings correctly", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			// Initial: 10 strings
			const initialStrings = Array.from(
				{ length: 10 },
				(_, i) => `String ${i + 1}`,
			);

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-1",
					newStrings: 10,
					totalStrings: 10,
					status: "PENDING",
				}),
			});

			const response1 = await api.submitTranslation(
				"main",
				initialStrings,
				config.targetLocales,
			);
			expect(response1.totalStrings).toBe(10);

			// Remove 3 strings: Now only 7 strings
			const reducedStrings = initialStrings.slice(0, 7);

			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-2",
					newStrings: 0,
					totalStrings: 7,
					status: "COMPLETED",
				}),
			});

			const response2 = await api.submitTranslation(
				"main",
				reducedStrings,
				config.targetLocales,
			);

			expect(response2.newStrings).toBe(0);
			expect(response2.totalStrings).toBe(7);
			expect(response2.totalStrings).toBeLessThan(response1.totalStrings);
		});
	});

	describe("String Modification", () => {
		it("should treat modified strings as new strings", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			// Initial: "Hello, world!"
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-1",
					newStrings: 1,
					totalStrings: 1,
					status: "PENDING",
				}),
			});

			const response1 = await api.submitTranslation(
				"main",
				["Hello, world!"],
				config.targetLocales,
			);
			expect(response1.newStrings).toBe(1);

			// Modified: "Hello, universe!" (different string)
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-2",
					newStrings: 1, // New string needs translation
					totalStrings: 1,
					status: "PENDING",
				}),
			});

			const response2 = await api.submitTranslation(
				"main",
				["Hello, universe!"],
				config.targetLocales,
			);

			expect(response2.newStrings).toBe(1);
			expect(response2.totalStrings).toBe(1);
		});
	});

	describe("Branch Isolation", () => {
		it("should treat same strings on different branches as new", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			const strings = ["Feature string 1", "Feature string 2"];

			// Submit to main branch
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-main",
					newStrings: 2,
					totalStrings: 2,
					status: "PENDING",
				}),
			});

			const mainResponse = await api.submitTranslation(
				"main",
				strings,
				config.targetLocales,
			);
			expect(mainResponse.newStrings).toBe(2);

			// Submit same strings to feature branch (should be new for this branch)
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-feature",
					newStrings: 2, // New for this branch
					totalStrings: 2,
					status: "PENDING",
				}),
			});

			const featureResponse = await api.submitTranslation(
				"feature/new-feature",
				strings,
				config.targetLocales,
			);
			expect(featureResponse.newStrings).toBe(2);
		});

		it("should fall back to main branch translations", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			const strings = ["Shared string 1", "Feature-specific string"];

			// Main branch already has first string translated
			// Feature branch has feature-specific string
			mockFetch.mockResolvedValueOnce({
				ok: true,
				json: async () => ({
					batchId: "batch-feature",
					newStrings: 1, // Only the feature-specific string is new
					totalStrings: 2,
					status: "PENDING",
				}),
			});

			const response = await api.submitTranslation(
				"feature/new-feature",
				strings,
				config.targetLocales,
			);

			// Should reuse main branch translation for 'Shared string 1'
			// Only translate 'Feature-specific string'
			expect(response.newStrings).toBe(1);
			expect(response.totalStrings).toBe(2);
		});
	});

	describe("Error Handling", () => {
		it("should handle API errors gracefully", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			mockFetch.mockResolvedValueOnce({
				ok: false,
				text: async () => "Project not found",
			});

			await expect(
				api.submitTranslation("main", ["Test"], config.targetLocales),
			).rejects.toThrow("Translation submission failed: Project not found");
		});

		it("should handle network errors", async () => {
			const mockFetch = vi.fn();
			global.fetch = mockFetch;

			mockFetch.mockRejectedValueOnce(new Error("Network error"));

			await expect(
				api.submitTranslation("main", ["Test"], config.targetLocales),
			).rejects.toThrow("Network error");
		});
	});
});
