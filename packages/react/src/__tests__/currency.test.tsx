/**
 * Currency formatting tests.
 *
 * Pattern: pass currency code explicitly or read locales[locale].currencyCode
 * from context. Never embed currency in translation strings — locale controls
 * number formatting (separators, symbol position), not which currency to use.
 */
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { T } from "../T";
import { useVocoder, VocoderProvider } from "../VocoderProvider";

// Intl currency output uses Unicode non-breaking spaces (U+00A0, U+202F) between
// number and symbol. Testing-library normalizes these away, breaking exact string
// matches. Normalize both sides to regular ASCII spaces before comparing.
function normCurrency(s: string) {
	return s
		.replace(/ | | | /g, " ")
		.trim();
}

function expectCurrencyInBody(expected: string) {
	const actual = normCurrency(document.body.textContent ?? "");
	expect(actual).toContain(normCurrency(expected));
}

// Component that reads currencyCode from context — the recommended pattern.
function ContextCurrencyPrice({ value }: { value: number }) {
	const { locale, locales } = useVocoder();
	const currency = locales?.[locale]?.currencyCode ?? "USD";
	return <T format="currency" currency={currency} value={value} />;
}

describe("format=currency — explicit currency prop", () => {
	it("formats USD in en locale", async () => {
		const expected = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(9.99);
		render(
			<VocoderProvider>
				<T format="currency" currency="USD" value={9.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("formats EUR in en locale", async () => {
		const expected = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(9.99);
		render(
			<VocoderProvider>
				<T format="currency" currency="EUR" value={9.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("formats USD with fr locale number rules", async () => {
		document.cookie = "vocoder_locale=fr; Path=/";
		const expected = new Intl.NumberFormat("fr", { style: "currency", currency: "USD" }).format(9.99);
		render(
			<VocoderProvider>
				<T format="currency" currency="USD" value={9.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("locale formatting differs between en and fr for same currency", () => {
		// Demonstrates separation: locale = how it looks, currency = which one
		const enFormatted = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(1234.56);
		const frFormatted = new Intl.NumberFormat("fr", { style: "currency", currency: "EUR" }).format(1234.56);
		expect(normCurrency(enFormatted)).not.toBe(normCurrency(frFormatted));
	});

	it("falls back to String(value) when currency prop missing", async () => {
		render(
			<VocoderProvider>
				{/* @ts-expect-error — intentionally omitting required currency prop */}
				<T format="currency" value={9.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody("9.99"));
	});
});

describe("format=currency — currency from context (recommended pattern)", () => {
	it("uses currencyCode from locale config in en (USD)", async () => {
		const expected = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(49.99);
		render(
			<VocoderProvider>
				<ContextCurrencyPrice value={49.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("uses currencyCode from locale config in es (EUR)", async () => {
		document.cookie = "vocoder_locale=es; Path=/";
		const expected = new Intl.NumberFormat("es", { style: "currency", currency: "EUR" }).format(49.99);
		render(
			<VocoderProvider>
				<ContextCurrencyPrice value={49.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("uses currencyCode from locale config in pl (PLN)", async () => {
		document.cookie = "vocoder_locale=pl; Path=/";
		const expected = new Intl.NumberFormat("pl", { style: "currency", currency: "PLN" }).format(49.99);
		render(
			<VocoderProvider>
				<ContextCurrencyPrice value={49.99} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});
});

describe("ICU currency skeleton in message prop", () => {
	it("{amount, number, ::currency/USD} formats correctly", async () => {
		const expected = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(9.99);
		render(
			<VocoderProvider>
				<T message="{amount, number, ::currency/USD}" values={{ amount: 9.99 }} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("{amount, number, ::currency/EUR} formats with en locale rules", async () => {
		const expected = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(9.99);
		render(
			<VocoderProvider>
				<T message="{amount, number, ::currency/EUR}" values={{ amount: 9.99 }} />
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(expected));
	});

	it("{amount, number, ::currency/USD} in plural branch", async () => {
		const price = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(29.99);
		render(
			<VocoderProvider>
				<T
					message="{n, plural, one {# item for {price, number, ::currency/USD}} other {# items for {price, number, ::currency/USD}}}"
					values={{ n: 3, price: 29.99 }}
				/>
			</VocoderProvider>,
		);
		await waitFor(() => expectCurrencyInBody(`3 items for ${price}`));
	});
});
