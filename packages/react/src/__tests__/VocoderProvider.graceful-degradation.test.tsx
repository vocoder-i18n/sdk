import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const MISSING_LOCALE_DATA_WARNING =
	"Vocoder did not find any locale data. Falling back to source text. Ensure your generated locale files are available to the React SDK.";

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("VocoderProvider graceful degradation", () => {
	it("becomes ready, renders source text, and warns when no locale data is available", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.doMock("../runtime", () => ({
			getConfig: () => ({ sourceLocale: "", targetLocales: [], locales: {} }),
			getLocales: () => ({}),
			getTranslations: () => ({}),
			initializeVocoder: vi.fn().mockResolvedValue(undefined),
			loadLocale: vi.fn().mockResolvedValue({}),
			loadLocaleSync: vi.fn().mockReturnValue(null),
		}));

		const { T } = await import("../T");
		const { useVocoder, VocoderProvider } = await import("../VocoderProvider");

		function MissingLocaleDataComponent() {
			const { availableLocales, isReady, locale } = useVocoder();

			return (
				<div>
					<div data-testid="ready">{String(isReady)}</div>
					<div data-testid="locale">{locale}</div>
					<div data-testid="available">{availableLocales.join(",")}</div>
					<div data-testid="translation">
						<T>Hello</T>
					</div>
				</div>
			);
		}

		render(
			<VocoderProvider>
				<MissingLocaleDataComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		expect(screen.getByTestId("locale")).toHaveTextContent("en");
		expect(screen.getByTestId("available")).toHaveTextContent("");
		expect(screen.getByTestId("translation")).toHaveTextContent("Hello");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(MISSING_LOCALE_DATA_WARNING);
	});

	it("settles ready state and falls back to source text when locale loading fails during startup", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		vi.doMock("../runtime", () => ({
			getConfig: () => ({ sourceLocale: "en", targetLocales: ["es"], locales: {} }),
			getLocales: () => ({
				en: { nativeName: "English", isRTL: false },
				es: { nativeName: "Español", isRTL: false },
			}),
			getTranslations: () => ({}),
			initializeVocoder: vi.fn().mockResolvedValue(undefined),
			loadLocale: vi.fn().mockRejectedValue(new Error("missing file")),
			loadLocaleSync: vi.fn().mockReturnValue(null),
		}));

		const { T } = await import("../T");
		const { useVocoder, VocoderProvider } = await import("../VocoderProvider");

		function FailedLocaleLoadComponent() {
			const { availableLocales, isReady, locale } = useVocoder();

			return (
				<div>
					<div data-testid="ready">{String(isReady)}</div>
					<div data-testid="locale">{locale}</div>
					<div data-testid="available">{availableLocales.join(",")}</div>
					<div data-testid="translation">
						<T>Hello</T>
					</div>
				</div>
			);
		}

		render(
			<VocoderProvider>
				<FailedLocaleLoadComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		expect(screen.getByTestId("locale")).toHaveTextContent("en");
		expect(screen.getByTestId("available")).toHaveTextContent("en,es");
		expect(screen.getByTestId("translation")).toHaveTextContent("Hello");
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(MISSING_LOCALE_DATA_WARNING);
	});
});
