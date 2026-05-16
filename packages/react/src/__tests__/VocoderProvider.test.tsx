import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { generateMessageHash } from "@vocoder/core";
import { T } from "../T";
import { useVocoder, VocoderProvider } from "../VocoderProvider";
import type { LocaleManifest } from "../types";

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

describe("manifest mode", () => {
	const manifest: LocaleManifest = {
		version: 1,
		sourceLocale: "en",
		targetLocales: ["es", "ar"],
		locales: {
			en: { nativeName: "English", isRTL: false },
			es: { nativeName: "Español", isRTL: false },
			ar: { nativeName: "العربية", isRTL: true },
		},
		updatedAt: "2026-01-01T00:00:00.000Z",
		fingerprint: "test-fingerprint",
	};

	const enTranslations: Record<string, string> = {
		[generateMessageHash("Hello")]: "Hello",
		[generateMessageHash("Goodbye")]: "Goodbye",
	};

	const esTranslations: Record<string, string> = {
		[generateMessageHash("Hello")]: "Hola",
		[generateMessageHash("Goodbye")]: "Adios",
	};

	function ManifestTestComponent() {
		const { locale, setLocale, availableLocales, isReady, dir } = useVocoder();
		return (
			<div>
				<div data-testid="ready">{String(isReady)}</div>
				<div data-testid="locale">{locale}</div>
				<div data-testid="dir">{dir}</div>
				<div data-testid="translation"><T>Hello</T></div>
				<div data-testid="available">{availableLocales.join(",")}</div>
				<button onClick={() => setLocale("es")}>Switch to Spanish</button>
				<button onClick={() => setLocale("ar")}>Switch to Arabic</button>
			</div>
		);
	}

	it("initializes with manifest and initialTranslations; locale is sourceLocale", async () => {
		render(
			<VocoderProvider
				manifest={manifest}
				initialTranslations={enTranslations}
			>
				<ManifestTestComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		expect(screen.getByTestId("locale")).toHaveTextContent("en");
		expect(screen.getByTestId("translation")).toHaveTextContent("Hello");
		expect(screen.getByTestId("available")).toHaveTextContent("en,es,ar");
	});

	it("locale switch calls loadLocale prop and updates rendered text", async () => {
		const user = userEvent.setup();
		const loadLocale = vi.fn().mockResolvedValue(esTranslations);

		render(
			<VocoderProvider
				manifest={manifest}
				initialTranslations={enTranslations}
				loadLocale={loadLocale}
			>
				<ManifestTestComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		await user.click(screen.getByText("Switch to Spanish"));

		await waitFor(() => {
			expect(screen.getByTestId("locale")).toHaveTextContent("es");
			expect(screen.getByTestId("translation")).toHaveTextContent("Hola");
		});

		expect(loadLocale).toHaveBeenCalledWith("es");
	});

	it("RTL flag from manifest drives dir when an RTL locale is active", async () => {
		const user = userEvent.setup();
		const loadLocale = vi.fn().mockResolvedValue({});

		render(
			<VocoderProvider
				manifest={manifest}
				initialTranslations={enTranslations}
				loadLocale={loadLocale}
			>
				<ManifestTestComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		expect(screen.getByTestId("dir")).toHaveTextContent("ltr");

		await user.click(screen.getByText("Switch to Arabic"));

		await waitFor(() => {
			expect(screen.getByTestId("locale")).toHaveTextContent("ar");
		});

		expect(screen.getByTestId("dir")).toHaveTextContent("rtl");
	});

	it("falls back to source text when key is missing from translation map", async () => {
		render(
			<VocoderProvider
				manifest={manifest}
				initialTranslations={enTranslations}
			>
				<ManifestTestComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		// "Hello" is in enTranslations — renders translation
		expect(screen.getByTestId("translation")).toHaveTextContent("Hello");

		// An unmapped key renders the source text directly
		function MissingKeyComponent() {
			const { t } = useVocoder();
			return <div data-testid="missing">{t("This key does not exist")}</div>;
		}

		const { getByTestId } = render(
			<VocoderProvider manifest={manifest} initialTranslations={enTranslations}>
				<MissingKeyComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(getByTestId("missing")).toHaveTextContent("This key does not exist");
		});
	});
});
