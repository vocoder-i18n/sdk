import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { t } from "../translate";
import { VocoderProvider } from "../VocoderProvider";

function mountProvider() {
	return render(
		<VocoderProvider>
			<div>mounted</div>
		</VocoderProvider>,
	);
}

describe("t() function", () => {
	it("translates using generated locale data", async () => {
		mountProvider();

		await waitFor(() => {
			expect(t("Hello, world!")).toBe("Hello, world!");
		});
	});

	it("uses cookie-selected locale", async () => {
		document.cookie = "vocoder_locale=es; Path=/";
		mountProvider();

		await waitFor(() => {
			expect(t("Hello, world!")).toBe("Hola, mundo!");
		});
	});

	it("formats interpolation values", async () => {
		mountProvider();

		await waitFor(() => {
			expect(t("You have {count} messages", { count: 3 })).toBe(
				"You have 3 messages",
			);
		});
	});

	it("returns source text when translation is missing", async () => {
		mountProvider();

		await waitFor(() => {
			expect(t("Missing translation")).toBe("Missing translation");
		});
	});

	it("formats ICU plural in source locale", async () => {
		mountProvider();

		await waitFor(() => {
			expect(
				t("{count, plural, one {# item} other {# items}}", { count: 1 }),
			).toBe("1 item");
			expect(
				t("{count, plural, one {# item} other {# items}}", { count: 5 }),
			).toBe("5 items");
		});
	});

	it("translates then formats ICU plural", async () => {
		document.cookie = "vocoder_locale=es; Path=/";
		mountProvider();

		await waitFor(() => {
			expect(
				t("{count, plural, one {# item} other {# items}}", { count: 3 }),
			).toBe("3 articulos");
		});
	});

	it("id option bypasses text hash — looks up by explicit key", async () => {
		document.cookie = "vocoder_locale=es; Path=/";
		mountProvider();

		// "1w2u0qz" is the hash for "Hello" — passes any text but resolves via id
		await waitFor(() => {
			expect(t("ignored source text", {}, { id: "1w2u0qz" })).toBe("Hola");
		});
	});

	it("context changes lookup key — falls back to source when no match", async () => {
		document.cookie = "vocoder_locale=es; Path=/";
		mountProvider();

		// "Hello, world!" has a translation in es, but with context="ctx" the hash differs
		await waitFor(() => {
			expect(t("Hello, world!", {}, { context: "ctx" })).toBe("Hello, world!");
		});
	});
});
