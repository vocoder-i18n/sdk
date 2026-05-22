import { getContrast, hasBadContrast, mix, readableColor } from "color2k";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { LocaleSelector } from "../LocaleSelector";
import { VocoderContext, useVocoder, VocoderProvider } from "../VocoderProvider";
import type { LocaleSelectorProps, VocoderContextValue } from "../types";

const LIGHT_BORDER_WEIGHT = 0.08;
const LIGHT_HOVER_WEIGHT = 0.03;
const LIGHT_SELECTED_WEIGHT = 0.05;
const LIGHT_FOCUS_RING_WEIGHT = 0.5;
const DARK_BORDER_WEIGHT = 0.12;
const DARK_HOVER_WEIGHT = 0.06;
const DARK_SELECTED_WEIGHT = 0.1;
const DARK_FOCUS_RING_WEIGHT = 0.55;
const MIN_FOCUS_RING_CONTRAST = 3;

function LocaleStateObserver() {
	const { isReady, locale } = useVocoder();

	return (
		<div>
			<div data-testid="ready">{String(isReady)}</div>
			<div data-testid="locale">{locale}</div>
		</div>
	);
}

function renderLocaleSelector(props: LocaleSelectorProps = {}) {
	return render(
		<VocoderProvider>
			<LocaleStateObserver />
			<LocaleSelector {...props} />
		</VocoderProvider>,
	);
}

function getTrigger(): HTMLButtonElement {
	return screen.getByLabelText("Select language") as HTMLButtonElement;
}

function getInjectedStyles(): string {
	return document.querySelector("style")?.textContent ?? "";
}

function getContent(): HTMLElement {
	const content = screen.getByText("English").closest("[data-vocoder-content]");

	if (!content) {
		throw new Error("Locale selector content is not rendered");
	}

	return content as HTMLElement;
}

function pickReadableForeground(background: string): string {
	const foreground = readableColor(background);

	if (!hasBadContrast(foreground, "aa", background)) {
		return foreground;
	}

	return getContrast("#000000", background) >= getContrast("#ffffff", background)
		? "#000000"
		: "#ffffff";
}

function isDarkSurface(background: string): boolean {
	return getContrast("#ffffff", background) >= getContrast("#000000", background);
}

function deriveExpectedTokens(background: string, foreground: string) {
	const isDarkBackground = isDarkSurface(background);

	return {
		border: mix(
			background,
			foreground,
			isDarkBackground ? DARK_BORDER_WEIGHT : LIGHT_BORDER_WEIGHT,
		),
		hover: mix(
			background,
			foreground,
			isDarkBackground ? DARK_HOVER_WEIGHT : LIGHT_HOVER_WEIGHT,
		),
		focusRing: (() => {
			const candidate = mix(
				background,
				foreground,
				isDarkBackground ? DARK_FOCUS_RING_WEIGHT : LIGHT_FOCUS_RING_WEIGHT,
			);

			return getContrast(candidate, background) >= MIN_FOCUS_RING_CONTRAST
				? candidate
				: foreground;
		})(),
		selected: mix(
			background,
			foreground,
			isDarkBackground ? DARK_SELECTED_WEIGHT : LIGHT_SELECTED_WEIGHT,
		),
	};
}

async function waitForReady() {
	await waitFor(() => {
		expect(screen.getByTestId("ready")).toHaveTextContent("true");
	});
}

async function openLocaleMenu(user = userEvent.setup()) {
	await waitForReady();
	await user.click(getTrigger());

	await waitFor(() => {
		expect(screen.getByText("English")).toBeInTheDocument();
	});
}

function makeContextValue(
	overrides: Partial<VocoderContextValue> = {},
): VocoderContextValue {
	return {
		availableLocales: ["en", "es"],
		getDisplayName: (targetLocale: string) => targetLocale,
		hasTranslation: () => false,
		isReady: true,
		locale: "en",
		dir: "ltr",
		locales: {
			en: { nativeName: "English", isRTL: false },
			es: { nativeName: "Español", isRTL: false },
		},
		ordinal: (value: number) => String(value),
		setLocale: async () => {},
		t: (text: string) => text,
		...overrides,
	};
}

describe("LocaleSelector", () => {
	it("renders with neutral default theme tokens and still switches locales", async () => {
		const user = userEvent.setup();

		renderLocaleSelector();
		await waitForReady();

		expect(getTrigger().style.getPropertyValue("--vocoder-locale-bg")).toBe("");
		expect(getTrigger().style.getPropertyValue("--vocoder-locale-fg")).toBe("");
		expect(getTrigger().style.borderColor).toBe("");
		expect(getInjectedStyles()).toContain("--vocoder-locale-bg:#ffffff");
		expect(getInjectedStyles()).toContain(
			"--vocoder-locale-border:color-mix(in srgb,var(--vocoder-locale-bg) 92%,var(--vocoder-locale-fg) 8%)",
		);
		expect(getInjectedStyles()).toContain(
			"--vocoder-locale-focus-ring:color-mix(in srgb,var(--vocoder-locale-bg) 50%,var(--vocoder-locale-fg) 50%)",
		);

		await openLocaleMenu(user);
		await user.click(screen.getByText("Español"));

		await waitFor(() => {
			expect(screen.getByTestId("locale")).toHaveTextContent("es");
		});

		await openLocaleMenu(user);

		const activeItem = screen.getByText("Español").closest("[data-vocoder-item]");
		expect(activeItem).toHaveAttribute("data-active", "true");
	});

	it("derives an accessible foreground and secondary tokens from background only", async () => {
		const user = userEvent.setup();
		const background = "#f5c518";
		const foreground = pickReadableForeground(background);
		const expectedTokens = deriveExpectedTokens(background, foreground);

		renderLocaleSelector({ background });
		await waitForReady();

		const trigger = getTrigger();
		expect(trigger.style.getPropertyValue("--vocoder-locale-bg")).toBe(background);
		expect(trigger.style.getPropertyValue("--vocoder-locale-fg")).toBe(foreground);
		expect(trigger.style.getPropertyValue("--vocoder-locale-border")).toBe(
			expectedTokens.border,
		);
		expect(trigger.style.borderColor).toBe("");
		expect(trigger.style.getPropertyValue("--vocoder-locale-focus-ring")).toBe(
			expectedTokens.focusRing,
		);
		expect(trigger.style.getPropertyValue("--vocoder-locale-hover")).toBe(
			expectedTokens.hover,
		);
		expect(trigger.style.getPropertyValue("--vocoder-locale-selected")).toBe(
			expectedTokens.selected,
		);
		expect(hasBadContrast(foreground, "aa", background)).toBe(false);

		await openLocaleMenu(user);

		const content = getContent();
		expect(content.style.getPropertyValue("--vocoder-locale-bg")).toBe(background);
		expect(content.style.getPropertyValue("--vocoder-locale-fg")).toBe(foreground);
		expect(content.style.getPropertyValue("--vocoder-locale-border")).toBe(
			expectedTokens.border,
		);
		expect(content.style.borderColor).toBe("");
		expect(content.style.getPropertyValue("--vocoder-locale-focus-ring")).toBe(
			expectedTokens.focusRing,
		);
	});

	it("uses the explicit foreground and leaves background on the default theme path when only color is provided", async () => {
		const user = userEvent.setup();
		const color = "#663399";

		renderLocaleSelector({ color });
		await waitForReady();

		const trigger = getTrigger();
		expect(trigger.style.getPropertyValue("--vocoder-locale-bg")).toBe("");
		expect(trigger.style.getPropertyValue("--vocoder-locale-fg")).toBe(color);
		expect(trigger.style.getPropertyValue("--vocoder-locale-border")).toBe("");
		expect(getInjectedStyles()).toContain(
			"--vocoder-locale-hover:color-mix(in srgb,var(--vocoder-locale-bg) 97%,var(--vocoder-locale-fg) 3%)",
		);

		await openLocaleMenu(user);

		const content = getContent();
		expect(content.style.getPropertyValue("--vocoder-locale-bg")).toBe("");
		expect(content.style.getPropertyValue("--vocoder-locale-fg")).toBe(color);
		expect(content.style.getPropertyValue("--vocoder-locale-selected")).toBe("");
	});

	it("trusts explicit background and color together while deriving secondary tokens from the explicit foreground", async () => {
		const user = userEvent.setup();
		const background = "#0f172a";
		const color = "#f8fafc";
		const expectedTokens = deriveExpectedTokens(background, color);

		renderLocaleSelector({ background, color });
		await waitForReady();

		const trigger = getTrigger();
		expect(trigger.style.getPropertyValue("--vocoder-locale-bg")).toBe(background);
		expect(trigger.style.getPropertyValue("--vocoder-locale-fg")).toBe(color);
		expect(trigger.style.getPropertyValue("--vocoder-locale-hover")).toBe(
			expectedTokens.hover,
		);

		await openLocaleMenu(user);

		const content = getContent();
		expect(content.style.getPropertyValue("--vocoder-locale-bg")).toBe(background);
		expect(content.style.getPropertyValue("--vocoder-locale-fg")).toBe(color);
		expect(content.style.getPropertyValue("--vocoder-locale-selected")).toBe(
			expectedTokens.selected,
		);
	});

	it("fails soft on invalid custom colors and keeps the selector usable", async () => {
		const user = userEvent.setup();

		renderLocaleSelector({ background: "not-a-color" });
		await waitForReady();

		const trigger = getTrigger();
		expect(trigger.style.getPropertyValue("--vocoder-locale-bg")).toBe("");
		expect(trigger.style.getPropertyValue("--vocoder-locale-fg")).toBe("");
		expect(trigger.style.getPropertyValue("--vocoder-locale-border")).toBe("");
		expect(trigger.style.getPropertyValue("--vocoder-locale-hover")).toBe("");
		expect(trigger.style.getPropertyValue("--vocoder-locale-selected")).toBe("");
		expect(getInjectedStyles()).toContain("--vocoder-locale-bg:#ffffff");

		await openLocaleMenu(user);
		expect(getContent()).toBeInTheDocument();
	});

	it("returns null when fewer than two locales are available", () => {
		render(
			<VocoderContext.Provider
				value={makeContextValue({
					availableLocales: ["en"],
					locales: {
						en: { nativeName: "English", isRTL: false },
					},
				})}
			>
				<LocaleSelector />
			</VocoderContext.Provider>,
		);

		expect(screen.queryByLabelText("Select language")).not.toBeInTheDocument();
	});
});
