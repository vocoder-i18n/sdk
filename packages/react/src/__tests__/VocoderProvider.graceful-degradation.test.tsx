import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { T } from "../T";
import { useVocoder, VocoderProvider } from "../VocoderProvider";
import type { LocaleManifest } from "../types";
import { createVocoder } from "@vocoder/core";

afterEach(() => {
	vi.restoreAllMocks();
});

const emptyManifest: LocaleManifest = {
	version: 1,
	sourceLocale: "en",
	targetLocales: [],
	locales: {
		en: { nativeName: "English", isRTL: false },
	},
	updatedAt: "2026-01-01T00:00:00.000Z",
	fingerprint: "test",
};

function DegradationComponent() {
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

describe("VocoderProvider graceful degradation", () => {
	it("becomes ready with an empty core — renders source text, no locale data", async () => {
		// Use an instance with no translations loaded — simulates first-run / missing files
		const emptyCore = createVocoder();
		emptyCore.load(emptyManifest, () => Promise.resolve({}));

		render(
			<VocoderProvider instance={emptyCore}>
				<DegradationComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		expect(screen.getByTestId("locale")).toHaveTextContent("en");
		// Only "en" in manifest, no translations loaded
		expect(screen.getByTestId("available")).toHaveTextContent("en");
		// Falls back to source text when translations are empty
		expect(screen.getByTestId("translation")).toHaveTextContent("Hello");
	});

	it("settles ready state and falls back to source text when locale loading fails", async () => {
		const failingLoader = vi.fn().mockRejectedValue(new Error("missing file"));

		const twoLocaleManifest: LocaleManifest = {
			version: 1,
			sourceLocale: "en",
			targetLocales: ["es"],
			locales: {
				en: { nativeName: "English", isRTL: false },
				es: { nativeName: "Español", isRTL: false },
			},
			updatedAt: "2026-01-01T00:00:00.000Z",
			fingerprint: "test",
		};

		const core = createVocoder();
		// Give the core no-op seeded translations so activate() skips the failing loader for 'en'
		core.load(twoLocaleManifest, failingLoader);
		core.seed("en", {}); // pre-seed so 'en' activation doesn't call the failing loader

		render(
			<VocoderProvider instance={core}>
				<DegradationComponent />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("ready")).toHaveTextContent("true");
		});

		expect(screen.getByTestId("locale")).toHaveTextContent("en");
		expect(screen.getByTestId("available")).toHaveTextContent("en,es");
		// Source text rendered since no translations
		expect(screen.getByTestId("translation")).toHaveTextContent("Hello");
	});
});
