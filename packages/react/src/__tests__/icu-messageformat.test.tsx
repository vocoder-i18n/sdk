import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { T } from "../T";
import { t } from "../translate";
import { VocoderProvider } from "../VocoderProvider";

describe("ICU MessageFormat", () => {
	it("formats plural messages with <T>", async () => {
		render(
			<VocoderProvider>
				<T
					message="{count, plural, =0 {No items} one {# item} other {# items}}"
					values={{ count: 5 }}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("5 items")).toBeInTheDocument();
		});
	});

	it("formats translated plural messages", async () => {
		document.cookie = "vocoder_locale=es; Path=/";

		render(
			<VocoderProvider>
				<T
					message="{count, plural, =0 {No items} one {# item} other {# items}}"
					values={{ count: 3 }}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("3 articulos")).toBeInTheDocument();
		});
	});

	it("formats select messages with t()", async () => {
		render(
			<VocoderProvider>
				<div>mounted</div>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(
				t("{gender, select, male {He} female {She} other {They}} replied", {
					gender: "female",
				}),
			).toBe("She replied");
		});
	});
});

// ─── ICU number / date skeletons inside message strings ──────────────────────

describe("ICU number and date formatting in messages", () => {
	it("{amount, number} formats with locale number rules", async () => {
		const expected = new Intl.NumberFormat("en").format(1234);
		render(
			<VocoderProvider>
				<T message="Total: {amount, number}" values={{ amount: 1234 }} />
			</VocoderProvider>,
		);
		await waitFor(() =>
			expect(screen.getByText(`Total: ${expected}`)).toBeInTheDocument(),
		);
	});

	it("{amount, number, ::percent} formats as percent", async () => {
		const expected = new Intl.NumberFormat("en", { style: "percent" }).format(0.75);
		render(
			<VocoderProvider>
				<T message="Progress: {amount, number, ::percent}" values={{ amount: 0.75 }} />
			</VocoderProvider>,
		);
		await waitFor(() =>
			expect(screen.getByText(`Progress: ${expected}`)).toBeInTheDocument(),
		);
	});

	it("{date, date, short} formats date with short style", async () => {
		const d = new Date("2024-06-15T12:00:00.000Z");
		const expected = new Intl.DateTimeFormat("en", { dateStyle: "short" }).format(d);
		render(
			<VocoderProvider>
				<T message="Expires: {date, date, short}" values={{ date: d }} />
			</VocoderProvider>,
		);
		await waitFor(() =>
			expect(screen.getByText(`Expires: ${expected}`)).toBeInTheDocument(),
		);
	});

	it("{date, date, long} formats date with long style", async () => {
		const d = new Date("2024-06-15T12:00:00.000Z");
		const expected = new Intl.DateTimeFormat("en", { dateStyle: "long" }).format(d);
		render(
			<VocoderProvider>
				<T message="On {date, date, long}" values={{ date: d }} />
			</VocoderProvider>,
		);
		await waitFor(() =>
			expect(screen.getByText(`On ${expected}`)).toBeInTheDocument(),
		);
	});
});
