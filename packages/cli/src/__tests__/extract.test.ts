import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StringExtractor } from "../utils/extract.js";

describe("StringExtractor", () => {
	let tempDir: string;
	let extractor: StringExtractor;

	function createTestFile(filename: string, content: string): string {
		tempDir = mkdtempSync(join(tmpdir(), "vocoder-test-"));
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

	describe("JSX <T> component extraction", () => {
		it("should extract simple text from <T> component", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Hello world</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello world");
			expect(result[0]!.file).toContain("test.tsx");
		});

		it("should extract text with variables from <T> component", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ name }: { name: string }) {
          return <T>Hello {name}!</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {name}!");
		});

		it("should extract context and formality from <T> component", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T context="greeting" formality="formal">Welcome</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Welcome");
			expect(result[0]!.context).toBe("greeting");
			expect(result[0]!.formality).toBe("formal");
		});

		it("should handle aliased imports", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T as Translate } from '@vocoder/react';

        function Component() {
          return <Translate>Hello</Translate>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});

		it("should extract text from message prop", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ count }: { count: number }) {
          return <T message="{count, plural, one {# item} other {# items}}" count={count} />;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe(
				"{count, plural, one {# item} other {# items}}",
			);
		});

		it("should prefer message prop over children", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T message="From message prop">From children</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("From message prop");
		});

		it("should extract ICU MessageFormat from message prop", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ status }: { status: string }) {
          return <T message="{status, select, pending {Order pending} shipped {Order shipped} other {Unknown}}" status={status} />;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe(
				"{status, select, pending {Order pending} shipped {Order shipped} other {Unknown}}",
			);
		});

		it("should extract message prop with context and formality", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ count }: { count: number }) {
          return <T message="{count, plural, one {# item} other {# items}}" context="shopping-cart" formality="informal" count={count} />;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe(
				"{count, plural, one {# item} other {# items}}",
			);
			expect(result[0]!.context).toBe("shopping-cart");
			expect(result[0]!.formality).toBe("informal");
		});

		it("should extract rich text with components from message prop", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T message="Click <link>here</link> for help" components={{ link: <a href="/help" /> }} />;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Click <link>here</link> for help");
		});

		it("should extract rich text with multiple components from message prop", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return (
            <T
              message="Read our <privacy>Privacy Policy</privacy> and <terms>Terms of Service</terms>"
              components={{
                privacy: <a href="/privacy" />,
                terms: <a href="/terms" />
              }}
            />
          );
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe(
				"Read our <privacy>Privacy Policy</privacy> and <terms>Terms of Service</terms>",
			);
		});
	});

	describe("t() function extraction", () => {
		it("should extract from direct t() import", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';

        const message = t('Hello world');
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello world");
		});

		it("should extract from useVocoder hook", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { useVocoder } from '@vocoder/react';

        function useMessages() {
          const { t } = useVocoder();

          return {
            welcome: t('Welcome back'),
            goodbye: t('See you soon'),
          };
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(2);
			expect(result.map((r: any) => r.text)).toContain("Welcome back");
			expect(result.map((r: any) => r.text)).toContain("See you soon");
		});

		it("should extract with template literals", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';

        function greet(name: string) {
          return t(\`Hello \${name}!\`);
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {name}!");
		});

		it("should extract context and formality from options", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';

        const message = t('Welcome', {}, {
          context: 'greeting',
          formality: 'formal'
        });
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Welcome");
			expect(result[0]!.context).toBe("greeting");
			expect(result[0]!.formality).toBe("formal");
		});

		it("should extract from custom hooks", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';

        function useValidationMessages() {
          return {
            required: t('This field is required'),
            email: t('Invalid email address'),
            minLength: t('Must be at least 8 characters'),
          };
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(3);
			expect(result.map((r: any) => r.text)).toContain(
				"This field is required",
			);
			expect(result.map((r: any) => r.text)).toContain("Invalid email address");
			expect(result.map((r: any) => r.text)).toContain(
				"Must be at least 8 characters",
			);
		});

		it("should extract from utility functions", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';

        export function formatUserRole(role: string): string {
          const roles = {
            admin: t('Administrator'),
            user: t('User'),
            guest: t('Guest'),
          };
          return roles[role] || role;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(3);
			expect(result.map((r: any) => r.text)).toContain("Administrator");
			expect(result.map((r: any) => r.text)).toContain("User");
			expect(result.map((r: any) => r.text)).toContain("Guest");
		});

		it("should handle aliased t function", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t as translate } from '@vocoder/react';

        const message = translate('Hello');
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});

		it("should handle renamed destructured t", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { useVocoder } from '@vocoder/react';

        function useMessages() {
          const { t: translate } = useVocoder();

          return translate('Hello');
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});
	});

	describe("Mixed usage", () => {
		it("should extract from both <T> and t() in same file", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T, useVocoder } from '@vocoder/react';

        function Component() {
          const { t } = useVocoder();
          const title = t('Page Title');

          return (
            <div>
              <h1>{title}</h1>
              <T>Welcome to our site</T>
              <p>{t('This is a description')}</p>
            </div>
          );
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(3);
			expect(result.map((r: any) => r.text)).toContain("Page Title");
			expect(result.map((r: any) => r.text)).toContain("Welcome to our site");
			expect(result.map((r: any) => r.text)).toContain("This is a description");
		});
	});

	describe("Deduplication", () => {
		it("should deduplicate identical strings", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T, t } from '@vocoder/react';

        function Component() {
          const msg1 = t('Hello');
          const msg2 = t('Hello');

          return (
            <div>
              <T>Hello</T>
              <T>Hello</T>
            </div>
          );
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			// Should only have one "Hello" despite 4 occurrences
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});

		it("should keep strings with different contexts separate", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { t } from '@vocoder/react';

        const greeting = t('Welcome', {}, { context: 'greeting' });
        const title = t('Welcome', {}, { context: 'title' });
      `,
			);

			const result = await extractor.extractFromProject(file);

			// Should have two entries because contexts differ
			expect(result).toHaveLength(2);
			expect(result[0]!.context).not.toBe(result[1]!.context);
		});
	});

	describe("Currency and special characters", () => {
		it("should preserve literal dollar sign before variable placeholder", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ price }: { price: number }) {
          return <T price={price}>Price: \${"{price}"}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Price: ${price}");
		});

		it("should handle template literals with dollar signs in JSX", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ price }: { price: number }) {
          return <T price={price}>Price: {\`$\${price}\`}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Price: ${price}");
		});

		it("should handle template literals with variables in t() function", async () => {
			const file = createTestFile(
				"test.ts",
				`
        import { t } from '@vocoder/react';

        function formatPrice(price: number) {
          return t(\`Price: $\${price}\`);
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Price: ${price}");
		});
	});

	describe("ICU MessageFormat", () => {
		it("should extract ICU plural syntax correctly", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Counter({ count }: { count: number }) {
          return (
            <T count={count}>
              {"{count, plural, =0 {No items} one {# item} other {# items}}"}
            </T>
          );
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			// CRITICAL: ICU keywords must remain in English
			expect(result[0]!.text).toBe(
				"{count, plural, =0 {No items} one {# item} other {# items}}",
			);
			expect(result[0]!.text).toContain("plural");
			expect(result[0]!.text).not.toContain("pluriel");
			expect(result[0]!.text).not.toContain("plurale");
		});

		it("should extract ICU select syntax correctly", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function OrderStatus({ status }: { status: string }) {
          return (
            <T status={status}>
              {"{status, select, pending {Order pending} shipped {Order shipped} delivered {Order delivered} other {Unknown status}}"}
            </T>
          );
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			// CRITICAL: ICU keywords must remain in English
			expect(result[0]!.text).toContain("select");
			expect(result[0]!.text).not.toContain("sélectionner");
			expect(result[0]!.text).not.toContain("seleziona");
		});

		it("should extract ICU gender select correctly", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function GenderMessage({ gender }: { gender: string }) {
          return (
            <T gender={gender}>
              {"{gender, select, male {He} female {She} other {They}} replied to your message"}
            </T>
          );
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe(
				"{gender, select, male {He} female {She} other {They}} replied to your message",
			);
			expect(result[0]!.text).toContain("select");
		});

		it("should NOT translate ICU syntax when in template literals", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Counter({ count }: { count: number }) {
          return <T count={count}>{\`{count, plural, =0 {No items} one {# item} other {# items}}\`}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			// ICU syntax should remain unchanged even in template literals
			expect(result[0]!.text).toBe(
				"{count, plural, =0 {No items} one {# item} other {# items}}",
			);
			expect(result[0]!.text).toContain("plural");
		});
	});

	describe("Edge cases", () => {
		it("should skip empty strings", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T, t } from '@vocoder/react';

        function Component() {
          const empty1 = t('');
          return <T></T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(0);
		});

		it("should skip whitespace-only strings", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T, t } from '@vocoder/react';

        function Component() {
          const empty = t('   ');
          return <T>   </T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(0);
		});

		it("should not extract from non-vocoder t functions", async () => {
			const file = createTestFile(
				"test.ts",
				`
        // Not imported from @vocoder/react
        function t(text: string) {
          return text;
        }

        const message = t('This should not be extracted');
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(0);
		});
	});

	describe("numeric component placeholders and complex expressions", () => {
		it("emits <0> numeric format for JSX element children", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Read <a href="/docs">the docs</a> for help.</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Read <0>the docs</0> for help.");
		});

		it("emits sequential <0> <1> indices for multiple JSX element children", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>See <a href="/privacy">Privacy</a> and <a href="/terms">Terms</a>.</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("See <0>Privacy</0> and <1>Terms</1>.");
		});

		it("maps MemberExpression children to positional {0}", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ user }: { user: { name: string } }) {
          return <T>Hello {user.name}!</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {0}!");
		});

		it("maps CallExpression children to positional {0}", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Value: {Math.random()}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Value: {0}");
		});

		it("keeps named identifiers named and maps complex expressions positionally", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ count, user }: { count: number; user: { name: string } }) {
          return <T>{count} items by {user.name}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("{count} items by {0}");
		});

		it("handles MemberExpression inside template literal as positional", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ user }: { user: { name: string } }) {
          return <T>{\`Hello \${user.name}\`}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {0}");
		});

		it("inlines numeric literal children as literal text", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>You have {42} new messages</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("You have 42 new messages");
		});

		it("inlines float numeric literal children", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Price: {3.14}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Price: 3.14");
		});

		it("skips boolean literal children", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Active: {true}</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			// {true} renders nothing — extracted text is just the surrounding literal
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Active:");
		});

		it("skips null literal children", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Hello {null} world</T>;
        }
      `,
			);

			const result = await extractor.extractFromProject(file);

			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello  world");
		});

		it("bails on conditional expression — T not transformed", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ isNew }: { isNew: boolean }) {
          return <T>{isNew ? 'New' : 'Old'} item</T>;
        }
      `,
			);

			// Suppress expected warning
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await extractor.extractFromProject(file);
			warn.mockRestore();

			// Conditional expression = untranslatable unit; extractor skips the element
			expect(result).toHaveLength(0);
		});

		it("bails on logical AND expression — T not transformed", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ show }: { show: boolean }) {
          return <T>Status: {show && 'visible'}</T>;
        }
      `,
			);

			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await extractor.extractFromProject(file);
			warn.mockRestore();

			expect(result).toHaveLength(0);
		});

		it("bails on logical AND with JSX — T not transformed", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component({ show }: { show: boolean }) {
          return <T>Hello {show && <strong>world</strong>}</T>;
        }
      `,
			);

			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await extractor.extractFromProject(file);
			warn.mockRestore();

			expect(result).toHaveLength(0);
		});

		it("bails on nested <T> inside <T> — outer not transformed, inner extracted independently", async () => {
			const file = createTestFile(
				"test.tsx",
				`
        import { T } from '@vocoder/react';

        function Component() {
          return <T>Hello <T>world</T></T>;
        }
      `,
			);

			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const result = await extractor.extractFromProject(file);
			warn.mockRestore();

			// Outer T bails; inner T extracts independently as "world"
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("world");
		});
	});
});
