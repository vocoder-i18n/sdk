import { describe, expect, it, vi } from "vitest";
import { computeFingerprint, deduplicateByKey, extractFromContent } from "../index";

describe("extractFromContent", () => {
	describe("bail cases", () => {
		it("returns empty array when T is not imported from @vocoder/react", () => {
			const code = `
        import { T } from 'some-other-lib';
        function App() { return <T>Hello</T>; }
      `;
			expect(extractFromContent("app.tsx", code)).toHaveLength(0);
		});

		it("bails on nested <T> — outer skipped, inner extracted", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const code = `
        import { T } from '@vocoder/react';
        function App() { return <T>Hello <T>world</T></T>; }
      `;
			const result = extractFromContent("app.tsx", code);
			warn.mockRestore();
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("world");
		});

		it("bails on conditional expression inside T", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const code = `
        import { T } from '@vocoder/react';
        function App({ isNew }: { isNew: boolean }) {
          return <T>{isNew ? 'New' : 'Old'} item</T>;
        }
      `;
			const result = extractFromContent("app.tsx", code);
			warn.mockRestore();
			expect(result).toHaveLength(0);
		});

		it("bails on logical AND inside T", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const code = `
        import { T } from '@vocoder/react';
        function App({ show }: { show: boolean }) {
          return <T>Status: {show && 'visible'}</T>;
        }
      `;
			const result = extractFromContent("app.tsx", code);
			warn.mockRestore();
			expect(result).toHaveLength(0);
		});
	});

	describe("message prop extraction", () => {
		it("extracts from message prop (self-closing)", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App({ count }: { count: number }) {
          return <T message="{count, plural, one {# item} other {# items}}" count={count} />;
        }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("{count, plural, one {# item} other {# items}}");
		});

		it("prefers message prop over children when both present", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App() { return <T message="From prop">From children</T>; }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("From prop");
		});

		it("extracts context and formality from message prop usage", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App({ count }: { count: number }) {
          return <T message="{count, plural, one {# item} other {# items}}" context="cart" formality="informal" count={count} />;
        }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.context).toBe("cart");
			expect(result[0]!.formality).toBe("informal");
		});
	});

	describe("children extraction", () => {
		it("extracts plain text children", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App() { return <T>Hello world</T>; }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello world");
		});

		it("extracts named variable children", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App({ name }: { name: string }) { return <T>Hello {name}!</T>; }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {name}!");
		});

		it("maps JSX element children to numeric tags", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App() { return <T>Read <a href="/docs">the docs</a> for help.</T>; }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Read <0>the docs</0> for help.");
		});

		it("maps multiple JSX element children with sequential indices", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App() {
          return <T>See <a href="/privacy">Privacy</a> and <a href="/terms">Terms</a>.</T>;
        }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("See <0>Privacy</0> and <1>Terms</1>.");
		});

		it("maps MemberExpression to positional {0}", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App({ user }: { user: { name: string } }) {
          return <T>Hello {user.name}!</T>;
        }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {0}!");
		});

		it("inlines numeric literal children as literal text", () => {
			const code = `
        import { T } from '@vocoder/react';
        function App() { return <T>You have {42} messages</T>; }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("You have 42 messages");
		});
	});

	describe("aliased imports", () => {
		it("handles aliased T import", () => {
			const code = `
        import { T as Translate } from '@vocoder/react';
        function App() { return <Translate>Hello</Translate>; }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});

		it("handles aliased t import", () => {
			const code = `
        import { t as translate } from '@vocoder/react';
        const msg = translate('Hello');
      `;
			const result = extractFromContent("app.ts", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});
	});

	describe("t() extraction", () => {
		it("extracts from direct t() call", () => {
			const code = `
        import { t } from '@vocoder/react';
        const msg = t('Hello world');
      `;
			const result = extractFromContent("app.ts", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello world");
		});

		it("extracts context and formality from t() options (arg 2)", () => {
			const code = `
        import { t } from '@vocoder/react';
        const msg = t('Welcome', {}, { context: 'greeting', formality: 'formal' });
      `;
			const result = extractFromContent("app.ts", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.context).toBe("greeting");
			expect(result[0]!.formality).toBe("formal");
		});

		it("extracts from useVocoder destructured t", () => {
			const code = `
        import { useVocoder } from '@vocoder/react';
        function useMessages() {
          const { t } = useVocoder();
          return t('Hello');
        }
      `;
			const result = extractFromContent("app.tsx", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello");
		});

		it("converts template literal variables to ICU placeholders", () => {
			const code = `
        import { t } from '@vocoder/react';
        function greet(name: string) { return t(\`Hello \${name}!\`); }
      `;
			const result = extractFromContent("app.ts", code);
			expect(result).toHaveLength(1);
			expect(result[0]!.text).toBe("Hello {name}!");
		});

		it("skips empty strings", () => {
			const code = `
        import { t } from '@vocoder/react';
        const empty = t('');
      `;
			expect(extractFromContent("app.ts", code)).toHaveLength(0);
		});

		it("skips whitespace-only strings", () => {
			const code = `
        import { t } from '@vocoder/react';
        const ws = t('   ');
      `;
			expect(extractFromContent("app.ts", code)).toHaveLength(0);
		});
	});
});

describe("computeFingerprint", () => {
	it("returns 12-character hex string", () => {
		const fp = computeFingerprint("myapp", ["key1", "key2"]);
		expect(fp).toHaveLength(12);
		expect(fp).toMatch(/^[0-9a-f]{12}$/);
	});

	it("is deterministic", () => {
		const fp1 = computeFingerprint("myapp", ["key1", "key2"]);
		const fp2 = computeFingerprint("myapp", ["key1", "key2"]);
		expect(fp1).toBe(fp2);
	});

	it("is order-independent (sorts keys internally)", () => {
		const fp1 = computeFingerprint("myapp", ["key1", "key2", "key3"]);
		const fp2 = computeFingerprint("myapp", ["key3", "key1", "key2"]);
		expect(fp1).toBe(fp2);
	});

	it("differs for different appShortCode", () => {
		const fp1 = computeFingerprint("app1", ["key1"]);
		const fp2 = computeFingerprint("app2", ["key1"]);
		expect(fp1).not.toBe(fp2);
	});

	it("differs for different key sets", () => {
		const fp1 = computeFingerprint("myapp", ["key1"]);
		const fp2 = computeFingerprint("myapp", ["key1", "key2"]);
		expect(fp1).not.toBe(fp2);
	});
});

describe("deduplicateByKey", () => {
	it("removes duplicates by key, keeping first occurrence", () => {
		const items = [
			{ key: "abc", text: "first" },
			{ key: "def", text: "second" },
			{ key: "abc", text: "duplicate" },
		];
		const result = deduplicateByKey(items);
		expect(result).toHaveLength(2);
		expect(result.find((i) => i.key === "abc")!.text).toBe("first");
	});

	it("returns empty array for empty input", () => {
		expect(deduplicateByKey([])).toHaveLength(0);
	});

	it("returns all items when all keys are unique", () => {
		const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
		expect(deduplicateByKey(items)).toHaveLength(3);
	});
});
