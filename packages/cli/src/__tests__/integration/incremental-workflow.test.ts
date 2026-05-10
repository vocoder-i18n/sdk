import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppConfig } from "../../types.js";
import { VocoderAPI } from "../../utils/api.js";

/**
 * Integration tests for incremental translation workflow
 *
 * These tests run against the actual API (requires vocoder-app running on localhost:3000)
 *
 * To run these tests:
 * 1. Start vocoder-app: cd vocoder-app && pnpm run dev
 * 2. Run tests: pnpm test incremental-workflow
 *
 * Set RUN_INTEGRATION=true to run these tests
 */
describe.skipIf(process.env.RUN_INTEGRATION !== "true")(
	"Incremental Workflow Integration",
	() => {
		let api: VocoderAPI;
		let config: AppConfig;
		const testBranch = `test-incremental-${Date.now()}`;

		beforeAll(() => {
			config = {
				apiKey: "test-key",
				apiUrl: process.env.VOCODER_API_URL || "http://localhost:3000",
				projectName: "test-project",
				organizationName: "test-org",
				sourceLocale: "en",
				targetBranches: ["main"],
				targetLocales: ["es", "fr"],
				syncPolicy: {
					blockingBranches: ["main", "master"],
					blockingMode: "required",
					nonBlockingMode: "best-effort",
					defaultMaxWaitMs: 60000,
				},
				includePattern: "src/**/*.{tsx,jsx}",
				timeout: 120000,
			};

			api = new VocoderAPI(config);
		});

		afterAll(async () => {
			// Cleanup: Delete test translations
			// This would require a DELETE endpoint in the API
			// For now, test branch translations will remain in DB
		});

		it("should only translate new strings on subsequent runs", async () => {
			// First run: Submit 5 strings
			const initialStrings = [
				"Integration Test String 1",
				"Integration Test String 2",
				"Integration Test String 3",
				"Integration Test String 4",
				"Integration Test String 5",
			];

			const batch1 = await api.submitTranslation(
				testBranch,
				initialStrings,
				config.targetLocales,
			);

			expect(batch1.newStrings).toBe(5);
			expect(batch1.totalStrings).toBe(5);

			// Wait for translations to complete
			const completion1 = await api.waitForCompletion(
				batch1.batchId,
				config.timeout,
			);
			const translations1 = completion1.translations;

			// Verify we got translations for all locales
			expect(Object.keys(translations1)).toHaveLength(2); // es, fr
			expect(translations1.es).toBeDefined();
			expect(translations1.fr).toBeDefined();

			// Second run: Submit same 5 strings again
			const batch2 = await api.submitTranslation(
				testBranch,
				initialStrings,
				config.targetLocales,
			);

			// Should detect all strings as existing
			expect(batch2.newStrings).toBe(0);
			expect(batch2.totalStrings).toBe(5);

			// Should return immediately with existing translations
			const completion2 = await api.waitForCompletion(
				batch2.batchId,
				config.timeout,
			);
			expect(completion2.translations).toEqual(translations1);
		}, 60000); // 60 second timeout

		it("should handle adding one new string efficiently", async () => {
			const baseStrings = ["Base String 1", "Base String 2", "Base String 3"];

			// Submit base strings
			const batch1 = await api.submitTranslation(
				testBranch,
				baseStrings,
				config.targetLocales,
			);

			const start1 = Date.now();
			await api.waitForCompletion(batch1.batchId, config.timeout);
			const duration1 = Date.now() - start1;

			// Add one new string
			const withNewString = [...baseStrings, "Brand New String"];

			const batch2 = await api.submitTranslation(
				testBranch,
				withNewString,
				config.targetLocales,
			);

			expect(batch2.newStrings).toBe(1);
			expect(batch2.totalStrings).toBe(4);

			const start2 = Date.now();
			const { translations } = await api.waitForCompletion(
				batch2.batchId,
				config.timeout,
			);
			const duration2 = Date.now() - start2;

			// Verify new string was translated
			expect(translations.es["Brand New String"]).toBeDefined();
			expect(translations.fr["Brand New String"]).toBeDefined();

			// Adding 1 string should be significantly faster than translating 3 strings
			// Allow some variance for API overhead, but should be at least 2x faster
			expect(duration2).toBeLessThan(duration1 / 2);
		}, 120000); // 120 second timeout

		it("should handle string removal correctly", async () => {
			const allStrings = [
				"Removal Test String 1",
				"Removal Test String 2",
				"Removal Test String 3",
				"String to be removed",
			];

			// Submit all strings
			const batch1 = await api.submitTranslation(
				testBranch,
				allStrings,
				config.targetLocales,
			);

			await api.waitForCompletion(batch1.batchId, config.timeout);

			// Remove one string
			const reducedStrings = allStrings.slice(0, 3);

			const batch2 = await api.submitTranslation(
				testBranch,
				reducedStrings,
				config.targetLocales,
			);

			expect(batch2.newStrings).toBe(0);
			expect(batch2.totalStrings).toBe(3);

			const { translations } = await api.waitForCompletion(
				batch2.batchId,
				config.timeout,
			);

			// Removed string should not be in translations
			expect(translations.es["String to be removed"]).toBeUndefined();
			expect(translations.fr["String to be removed"]).toBeUndefined();

			// Other strings should still be present
			expect(translations.es["Removal Test String 1"]).toBeDefined();
		}, 60000);

		it("should handle string modification as new translation", async () => {
			const originalString = "This is the original text";
			const modifiedString = "This is the modified text";

			// Submit original
			const batch1 = await api.submitTranslation(
				testBranch,
				[originalString],
				config.targetLocales,
			);

			await api.waitForCompletion(batch1.batchId, config.timeout);

			// Submit modified version
			const batch2 = await api.submitTranslation(
				testBranch,
				[modifiedString],
				config.targetLocales,
			);

			// Should be treated as a new string
			expect(batch2.newStrings).toBe(1);
			expect(batch2.totalStrings).toBe(1);

			const { translations } = await api.waitForCompletion(
				batch2.batchId,
				config.timeout,
			);

			// Should have translation for modified string
			expect(translations.es[modifiedString]).toBeDefined();
			expect(translations.fr[modifiedString]).toBeDefined();

			// Original string should not be in the current translation set
			expect(translations.es[originalString]).toBeUndefined();
		}, 60000);

		it("should support large batches efficiently", async () => {
			// Test with 100 strings
			const largeSet = Array.from(
				{ length: 100 },
				(_, i) => `Large Batch String ${i + 1}`,
			);

			const batch1 = await api.submitTranslation(
				testBranch,
				largeSet,
				config.targetLocales,
			);

			expect(batch1.newStrings).toBe(100);

			const start = Date.now();
			const { translations } = await api.waitForCompletion(
				batch1.batchId,
				180000,
			); // 3 minute timeout
			const duration = Date.now() - start;

			// Verify all strings were translated
			expect(Object.keys(translations.es)).toHaveLength(100);
			expect(Object.keys(translations.fr)).toHaveLength(100);

			// Log performance metrics
			console.log(
				`Translated 100 strings in ${duration}ms (${duration / 100}ms per string)`,
			);

			// Re-submit same large set
			const batch2 = await api.submitTranslation(
				testBranch,
				largeSet,
				config.targetLocales,
			);

			expect(batch2.newStrings).toBe(0);

			// Should complete almost instantly since no translation needed
			const start2 = Date.now();
			await api.waitForCompletion(batch2.batchId, config.timeout);
			const duration2 = Date.now() - start2;

			// Second run should be at least 10x faster
			expect(duration2).toBeLessThan(duration / 10);
		}, 240000); // 4 minute timeout
	},
);
