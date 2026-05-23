import { describe, expect, it, vi } from "vitest";
import { transformMsgProps } from "../shared/transform.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function src(code: string) {
	return `import { T } from "@vocoder/react";\n${code}`;
}

async function transform(code: string) {
	return transformMsgProps(src(code));
}

// ── basic injection ───────────────────────────────────────────────────────────

describe("transformMsgProps", () => {
	it("injects id and message props for identifier child", async () => {
		const result = await transform("<T>You have {count} items</T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain('message="You have {count} items"');
		expect(result.code).toMatch(/id="[a-zA-Z0-9]+"/);
	});

	it("injects values prop for named identifier", async () => {
		const result = await transform("<T>Hello {name}</T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain("values={{");
		expect(result.code).toContain("name");
	});

	it("injects values prop for complex expression with positional key", async () => {
		const result = await transform("<T>Hello {user.name}</T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain('message="Hello {0}"');
		expect(result.code).toContain("0:");
		expect(result.code).toContain("user.name");
	});

	it("injects components prop for JSX element children", async () => {
		const result = await transform("<T>Hello <strong>world</strong></T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain('message="Hello <0>world</0>"');
		expect(result.code).toContain("components={[");
		expect(result.code).toContain("<strong />");
	});

	it("injects components for self-closing child element", async () => {
		const result = await transform("<T>Press <kbd /> to continue</T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain("components={[");
	});

	it("injects both values and components together", async () => {
		const result = await transform("<T>Hello <strong>{name}</strong></T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain("values={{");
		expect(result.code).toContain("components={[");
	});

	// ── id is stable and matches hash of the template ─────────────────────────

	it("produces stable id matching generateMessageHash output", async () => {
		const { generateMessageHash } = await import("@vocoder/core");
		const result = await transform("<T>Hello {name}</T>");
		const expected = generateMessageHash("Hello {name}");
		expect(result.code).toContain(`id="${expected}"`);
	});

	// ── no-op cases ───────────────────────────────────────────────────────────

	it("is a no-op when message prop already present", async () => {
		const result = await transform(`<T message="Already set">ignored</T>`);
		expect(result.changed).toBe(false);
	});

	it("is a no-op for static-only text children", async () => {
		const result = await transform("<T>Hello world</T>");
		expect(result.changed).toBe(false);
	});

	it("is a no-op when file has no @vocoder/react import", async () => {
		const result = await transformMsgProps("<T>Hello {name}</T>");
		expect(result.changed).toBe(false);
	});

	it("is a no-op for plural/select mode (CLDR props)", async () => {
		const result = await transform("<T one=\"One item\" other=\"{count} items\" count={count} />");
		expect(result.changed).toBe(false);
	});

	it("is a no-op for _N positional props", async () => {
		const result = await transform('<T _0="First" _1="Second" />');
		expect(result.changed).toBe(false);
	});

	it("is a no-op for _word select props", async () => {
		const result = await transform('<T _male="He" _female="She" gender={gender}>They</T>');
		expect(result.changed).toBe(false);
	});

	// ── bail cases ────────────────────────────────────────────────────────────

	it("skips and warns on ternary direct child", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await transform("<T>{cond ? 'A' : 'B'}</T>");
		expect(result.changed).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Conditional/logical"));
		warn.mockRestore();
	});

	it("skips and warns on logical expression direct child", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await transform("<T>{flag && 'text'}</T>");
		expect(result.changed).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Conditional/logical"));
		warn.mockRestore();
	});

	it("skips outer <T> and warns when nested <T> detected", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await transform("<T>Outer <T>inner</T></T>");
		// outer T bails when it encounters the nested T during extraction
		expect(result.changed).toBe(false);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unsupported expression"));
		warn.mockRestore();
	});

	// ── renamed import ────────────────────────────────────────────────────────

	it("handles renamed T import", async () => {
		const result = await transformMsgProps(
			`import { T as Trans } from "@vocoder/react";\n<Trans>Hello {name}</Trans>`,
		);
		expect(result.changed).toBe(true);
		expect(result.code).toContain('message="Hello {name}"');
	});

	it("ignores non-T components", async () => {
		const result = await transform("<div>Hello {name}</div>");
		expect(result.changed).toBe(false);
	});

	// ── source maps ───────────────────────────────────────────────────────────

	it("includes inline source map in output", async () => {
		const result = await transform("<T>Hello {name}</T>");
		expect(result.changed).toBe(true);
		expect(result.code).toContain("//# sourceMappingURL=data:application/json");
	});

	// ── parse errors ──────────────────────────────────────────────────────────

	it("returns unchanged code on parse error", async () => {
		const broken = `import { T } from "@vocoder/react";\n<T unclosed`;
		const result = await transformMsgProps(broken);
		expect(result.changed).toBe(false);
		expect(result.code).toBe(broken);
	});
});
