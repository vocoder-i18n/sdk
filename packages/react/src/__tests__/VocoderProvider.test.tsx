import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { describe, expect, it } from "vitest";
import { T } from "../T";
import { useVocoder, VocoderProvider } from "../VocoderProvider";

function TestComponent() {
	const { locale, setLocale, availableLocales, isReady } = useVocoder();

	return (
		<div>
			<div data-testid="ready">{String(isReady)}</div>
			<div data-testid="locale">{locale}</div>
			<div data-testid="translation"><T>Hello</T></div>
			<div data-testid="available">{availableLocales.join(",")}</div>
			<button onClick={() => setLocale("es")}>Switch to Spanish</button>
			<button onClick={() => setLocale("fr")}>Switch to French</button>
		</div>
	);
}

describe("VocoderProvider", () => {
	it("loads generated translations and exposes locales", async () => {
		render(
			<VocoderProvider>
				<TestComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
			expect(screen.getByTestId("translation")).toHaveTextContent("Hello");
		});

		expect(screen.getByTestId("available")).toHaveTextContent("en,es,fr,pl");
		expect(screen.getByTestId("locale")).toHaveTextContent("en");
	});

	it("switches locale and persists cookie preference", async () => {
		const user = userEvent.setup();

		render(
			<VocoderProvider>
				<TestComponent />
			</VocoderProvider>,
		);

		await user.click(screen.getByText("Switch to Spanish"));

		await waitFor(() => {
			expect(screen.getByTestId("locale")).toHaveTextContent("es");
			expect(screen.getByTestId("translation")).toHaveTextContent("Hola");
		});

		expect(document.cookie).toContain("vocoder_locale=es");
	});

	it("uses cookie locale on initial render", async () => {
		document.cookie = "vocoder_locale=fr; Path=/";

		render(
			<VocoderProvider>
				<TestComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("locale")).toHaveTextContent("fr");
			expect(screen.getByTestId("translation")).toHaveTextContent("Bonjour");
		});
	});

	it("throws when useVocoder is used outside provider", () => {
		const originalError = console.error;
		console.error = () => {};

		expect(() => {
			render(<TestComponent />);
		}).toThrow("useVocoder must be used inside VocoderProvider");

		console.error = originalError;
	});
});
