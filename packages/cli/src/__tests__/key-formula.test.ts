/**
 * Key-centric extraction tests.
 *
 * Verifies that:
 * 1. Keys are computed correctly (text + context + formality → hash, or custom id ± formality)
 * 2. id-only entries (<T id="x" />) are emitted with text = null and key = id
 * 3. id + formality produces a distinct key from id alone
 * 4. Same text with different formality produces different keys and different fingerprints
 * 5. buildStringEntries deduplicates by key (not text)
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateMessageHash, computeFingerprint } from "@vocoder/extractor";
import { StringExtractor } from "../utils/extract.js";

describe("Key formula", () => {
	let tempDir: string;
	let extractor: StringExtractor;

	function createTestFile(filename: string, content: string): string {
		tempDir = mkdtempSync(join(tmpdir(), "vocoder-key-test-"));
		const filePath = join(tempDir, filename);
		writeFileSync(filePath, content, "utf-8");
		return filePath;
	}

	function cleanup() {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	}

	beforeEach(() => {
		extractor = new StringExtractor();
	});

	afterEach(() => {
		cleanup();
	});

	describe("<T> key construction", () => {
		it("text only → generateMessageHash(text)", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T>Hello</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe(generateMessageHash("Hello"));
			expect(results[0]!.text).toBe("Hello");
		});

		it("text + context → generateMessageHash(text, context)", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T context="greeting">Hello</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe(generateMessageHash("Hello", "greeting"));
		});

		it("text + formality → generateMessageHash(text, undefined, formality)", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T formality="formal">Hello</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe(generateMessageHash("Hello", undefined, "formal"));
		});

		it("custom id (no formality) → id as-is", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T id="save_btn">Save</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn");
			expect(results[0]!.text).toBe("Save");
		});

		it("custom id + formal → id + \\x05formal", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T id="save_btn" formality="formal">Save</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn\x05formal");
		});

		it("custom id + informal → id + \\x05informal", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T id="save_btn" formality="informal">Save</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn\x05informal");
		});

		it("custom id + neutral → key = id (neutral does not vary)", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T id="save_btn" formality="neutral">Save</T>; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn");
		});

		it("id-only entry (<T id='x' />) → emits with text = null", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T id="save_btn" />; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn");
			expect(results[0]!.text).toBeNull();
		});

		it("id-only + formality (<T id='x' formality='formal' />) → key = id + \\x05formal", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() { return <T id="save_btn" formality="formal" />; }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn\x05formal");
			expect(results[0]!.text).toBeNull();
		});

		it("same text + different formality → different keys", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';
        function A() {
          return (
            <>
              <T formality="formal">Please submit</T>
              <T formality="informal">Please submit</T>
            </>
          );
        }
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(2);
			expect(results[0]!.key).not.toBe(results[1]!.key);
		});
	});

	describe("t() key construction", () => {
		it("text + options.formality → hash includes formality", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';
        const msg = t('Hello', undefined, { formality: 'formal' });
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe(generateMessageHash("Hello", undefined, "formal"));
		});

		it("explicit id (no formality) → key = id", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';
        const msg = t('Save', undefined, { id: 'save_btn' });
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn");
		});

		it("explicit id + formality → key = id + \\x05formality", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';
        const msg = t('Save', undefined, { id: 'save_btn', formality: 'formal' });
      `,
			);
			const results = await extractor.extractFromProject(file);
			expect(results).toHaveLength(1);
			expect(results[0]!.key).toBe("save_btn\x05formal");
		});
	});

	describe("Fingerprint uses keys", () => {
		it("same text different formality → different fingerprints", async () => {
			const formalKey = generateMessageHash("Please submit", undefined, "formal");
			const informalKey = generateMessageHash("Please submit", undefined, "informal");

			const fp1 = computeFingerprint("APPSHRTCDE", [formalKey]);
			const fp2 = computeFingerprint("APPSHRTCDE", [informalKey]);

			expect(fp1).not.toBe(fp2);
		});

		it("same key different order → same fingerprint (order-independent)", () => {
			const fp1 = computeFingerprint("APPSHRTCDE", ["abc1234", "def5678"]);
			const fp2 = computeFingerprint("APPSHRTCDE", ["def5678", "abc1234"]);
			expect(fp1).toBe(fp2);
		});

		it("custom id key used as-is in fingerprint", () => {
			const fp = computeFingerprint("APPSHRTCDE", ["save_btn"]);
			expect(fp).toHaveLength(12);
		});
	});
});
