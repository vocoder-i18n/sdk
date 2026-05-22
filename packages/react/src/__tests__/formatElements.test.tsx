import type React from "react";
import { describe, expect, it } from "vitest";
import { formatElements } from "../utils/formatElements";

describe("formatElements", () => {
	it("replaces a paired placeholder with the slot element + inner text as children", () => {
		const result = formatElements("<0>click here</0>", [<a key="0" href="/x" />]);
		expect(result).toHaveLength(1);
		const el = result[0] as React.ReactElement;
		expect(el.type).toBe("a");
		expect(el.props.href).toBe("/x");
		expect(el.props.children).toBe("click here");
	});

	it("replaces a self-closing placeholder with the slot element (no children)", () => {
		const result = formatElements("before <0/> after", [<img key="0" alt="icon" />]);
		expect(result).toHaveLength(3);
		expect(result[0]).toBe("before ");
		const el = result[1] as React.ReactElement;
		expect(el.type).toBe("img");
		expect(result[2]).toBe(" after");
	});

	it("preserves surrounding text", () => {
		const result = formatElements("Read <0>the docs</0> for help.", [<a key="0" href="/docs" />]);
		expect(result).toHaveLength(3);
		expect(result[0]).toBe("Read ");
		expect(result[2]).toBe(" for help.");
	});

	it("handles multiple sequential placeholders", () => {
		const result = formatElements(
			"<0>Privacy</0> and <1>Terms</1>",
			[<a key="privacy" href="/privacy" />, <a key="terms" href="/terms" />],
		);
		expect(result).toHaveLength(3); // slot0, " and ", slot1
		const el0 = result[0] as React.ReactElement;
		const el1 = result[2] as React.ReactElement;
		expect(el0.props.href).toBe("/privacy");
		expect(el1.props.href).toBe("/terms");
	});

	it("handles sparse object form — index 1 absent renders literally", () => {
		const result = formatElements(
			"<0>A</0> mid <1>B</1> end <2>C</2>",
			{ 0: <em />, 2: <strong /> },
		);
		// slot0 → em, " mid ", literal "<1>B</1>", " end ", slot2 → strong
		const texts = result.filter((n): n is string => typeof n === "string");
		expect(texts).toContain(" mid ");
		expect(texts).toContain(" end ");
		// <1>B</1> has no matching slot — rendered as literal
		expect(texts.some((t) => t.includes("B"))).toBe(true);
	});

	it("calls function slot with inner ReactNode children", () => {
		const calls: React.ReactNode[] = [];
		const slot = (children: React.ReactNode) => {
			calls.push(children);
			return <strong>{children}</strong>;
		};
		const result = formatElements("<0>hello</0>", [slot]);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toBe("hello");
		// The Fragment wrapper from formatElements
		expect(result).toHaveLength(1);
	});

	it("returns unknown index placeholder as literal text (surrounding text is separate nodes)", () => {
		const result = formatElements("before <5>text</5> after", []);
		// Surrounding text and unmatched tag are separate nodes in the result
		expect(result).toHaveLength(3);
		expect(result[0]).toBe("before ");
		expect(result[1]).toBe("<5>text</5>");
		expect(result[2]).toBe(" after");
	});

	it("handles nested placeholders recursively", () => {
		const outer = <div />;
		const inner = <span />;
		const result = formatElements("<0><1>nested</1></0>", [outer, inner]);
		expect(result).toHaveLength(1);
		const outerEl = result[0] as React.ReactElement;
		expect(outerEl.type).toBe("div");
		// Inner children: when a single child is passed, React gives it as-is (not an array)
		const children = outerEl.props.children;
		const innerEl = (Array.isArray(children) ? children[0] : children) as React.ReactElement;
		expect(innerEl.type).toBe("span");
	});
});
