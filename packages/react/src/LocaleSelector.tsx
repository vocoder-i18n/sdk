import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import { getContrast, hasBadContrast, mix, readableColor } from "color2k";

import type { LocaleSelectorProps } from "./types";
import React from "react";
import { isVocoderEnabled } from "./preview";
import { useVocoder } from "./VocoderProvider";

const POSITION_MAP: Record<string, string> = {
	tl: "top-left",
	tr: "top-right",
	bl: "bottom-left",
	br: "bottom-right",
};

const TRIGGER_ATTR = "data-vocoder-trigger";
const CONTENT_ATTR = "data-vocoder-content";
const ITEM_ATTR = "data-vocoder-item";

const LIGHT_BG = "#ffffff";
const LIGHT_FG = "#1a1a1a";
const DARK_BG = "#1a1a1a";
const DARK_FG = "#ffffff";
const LIGHT_BORDER_WEIGHT = 0.08;
const LIGHT_HOVER_WEIGHT = 0.03;
const LIGHT_SELECTED_WEIGHT = 0.05;
const LIGHT_FOCUS_RING_WEIGHT = 0.5;
const DARK_BORDER_WEIGHT = 0.12;
const DARK_HOVER_WEIGHT = 0.06;
const DARK_SELECTED_WEIGHT = 0.1;
const DARK_FOCUS_RING_WEIGHT = 0.55;
const MIN_FOCUS_RING_CONTRAST = 3;

type LocaleSelectorThemeVars = React.CSSProperties & {
	"--vocoder-locale-bg"?: string;
	"--vocoder-locale-fg"?: string;
	"--vocoder-locale-border"?: string;
	"--vocoder-locale-focus-ring"?: string;
	"--vocoder-locale-hover"?: string;
	"--vocoder-locale-selected"?: string;
};

type LocaleSelectorResolvedTheme = {
	vars?: LocaleSelectorThemeVars;
};

function isValidColor(value: string): boolean {
	try {
		readableColor(value);
		return true;
	} catch {
		return false;
	}
}

function isDarkSurface(background: string): boolean {
	return getContrast("#ffffff", background) >= getContrast("#000000", background);
}

function resolveReadableForeground(background: string): string {
	let foreground = readableColor(background);

	if (hasBadContrast(foreground, "aa", background)) {
		foreground =
			getContrast("#000000", background) >= getContrast("#ffffff", background)
				? "#000000"
				: "#ffffff";
	}

	return foreground;
}

function deriveThemeVars(background: string, foreground: string): LocaleSelectorThemeVars {
	const isDarkBackground = isDarkSurface(background);
	const borderWeight = isDarkBackground ? DARK_BORDER_WEIGHT : LIGHT_BORDER_WEIGHT;
	const hoverWeight = isDarkBackground ? DARK_HOVER_WEIGHT : LIGHT_HOVER_WEIGHT;
	const selectedWeight = isDarkBackground ? DARK_SELECTED_WEIGHT : LIGHT_SELECTED_WEIGHT;
	const focusRingCandidate = mix(
		background,
		foreground,
		isDarkBackground ? DARK_FOCUS_RING_WEIGHT : LIGHT_FOCUS_RING_WEIGHT,
	);
	const focusRing =
		getContrast(focusRingCandidate, background) >= MIN_FOCUS_RING_CONTRAST
			? focusRingCandidate
			: foreground;

	return {
		"--vocoder-locale-bg": background,
		"--vocoder-locale-fg": foreground,
		"--vocoder-locale-border": mix(background, foreground, borderWeight),
		"--vocoder-locale-focus-ring": focusRing,
		"--vocoder-locale-hover": mix(background, foreground, hoverWeight),
		"--vocoder-locale-selected": mix(background, foreground, selectedWeight),
	};
}

function resolveThemeOverrides(
	background?: string,
	color?: string,
): LocaleSelectorResolvedTheme {
	const validBackground = background && isValidColor(background) ? background : undefined;
	const validColor = color && isValidColor(color) ? color : undefined;

	if (!validBackground && !validColor) return {};

	try {
		if (validBackground) {
			const foreground = validColor ?? resolveReadableForeground(validBackground);
			return { vars: deriveThemeVars(validBackground, foreground) };
		}

		return {
			vars: {
				"--vocoder-locale-fg": validColor,
			},
		};
	} catch {
		return validColor
			? {
					vars: {
						"--vocoder-locale-fg": validColor,
					},
				}
			: {};
	}
}

// Default theme matching stays CSS-only via .dark ancestor selectors.
// next-themes adds .dark to <html> via an inline script before first paint,
// so the correct colors are applied with no JS, no MutationObserver, no flash.
// Covers next-themes (.dark), shadcn, Tailwind, and [data-theme="dark"] conventions.
// Custom background/color props override the CSS variables, with JS only used
// to resolve a readable foreground and mix subtle supporting tones when needed.
const STYLES = `
[${TRIGGER_ATTR}]:focus{outline:none;}
[${TRIGGER_ATTR}],[${CONTENT_ATTR}]{
	--vocoder-locale-bg:${LIGHT_BG};
	--vocoder-locale-fg:${LIGHT_FG};
	--vocoder-locale-border:color-mix(in srgb,var(--vocoder-locale-bg) 92%,var(--vocoder-locale-fg) 8%);
	--vocoder-locale-focus-ring:color-mix(in srgb,var(--vocoder-locale-bg) 50%,var(--vocoder-locale-fg) 50%);
	--vocoder-locale-hover:color-mix(in srgb,var(--vocoder-locale-bg) 97%,var(--vocoder-locale-fg) 3%);
	--vocoder-locale-selected:color-mix(in srgb,var(--vocoder-locale-bg) 95%,var(--vocoder-locale-fg) 5%);
	background-color:var(--vocoder-locale-bg);
	color:var(--vocoder-locale-fg);
	border-color:var(--vocoder-locale-border);
}
.dark [${TRIGGER_ATTR}],.dark [${CONTENT_ATTR}],[data-theme="dark"] [${TRIGGER_ATTR}],[data-theme="dark"] [${CONTENT_ATTR}]{
	--vocoder-locale-bg:${DARK_BG};
	--vocoder-locale-fg:${DARK_FG};
	--vocoder-locale-border:color-mix(in srgb,var(--vocoder-locale-bg) 88%,var(--vocoder-locale-fg) 12%);
	--vocoder-locale-focus-ring:color-mix(in srgb,var(--vocoder-locale-bg) 45%,var(--vocoder-locale-fg) 55%);
	--vocoder-locale-hover:color-mix(in srgb,var(--vocoder-locale-bg) 94%,var(--vocoder-locale-fg) 6%);
	--vocoder-locale-selected:color-mix(in srgb,var(--vocoder-locale-bg) 90%,var(--vocoder-locale-fg) 10%);
}
[${TRIGGER_ATTR}]:focus-visible{
	outline:3px solid var(--vocoder-locale-focus-ring);
	outline-offset:0px;
}
@media (forced-colors: active){
	[${TRIGGER_ATTR}]:focus-visible{
		outline-color:Highlight;
	}
}
[${ITEM_ATTR}]{
	background-color:transparent;
	color:inherit;
}
[${ITEM_ATTR}]:hover,[${ITEM_ATTR}][data-highlighted]{
	background-color:var(--vocoder-locale-hover);
}
[${ITEM_ATTR}][data-active="true"],[${ITEM_ATTR}][data-active="true"]:hover,[${ITEM_ATTR}][data-active="true"][data-highlighted]{
	background-color:var(--vocoder-locale-selected);
	font-weight:600;
}
`;

const VocoderLogo = ({ size }: { size: number }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 136 136"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
	>
		<path
			fillRule="evenodd"
			clipRule="evenodd"
			d="M84 20C101.673 20.0004 116 34.3272 116 52L116.004 60C116.004 77.6719 101.676 91.9985 84.0039 92H69.4219L40.0039 116V89.6641C28.2816 84.9171 20.0045 73.4323 20.0039 60L20 52C20.0005 34.3273 34.3273 20.0001 52 20H84ZM48 83.8555L48.0039 83.8594V99.0938L58.6914 90.4062C54.6099 88.9674 50.9658 86.6107 48 83.582V83.8555ZM96 64C95.9999 71.6713 92.9113 78.6186 87.9141 83.6758C99.3023 81.8079 107.992 71.9304 108 60.0156H96V64ZM48 64C48.0004 73.6752 54.8716 81.7444 64 83.5977V60.0078L48 60.0039V64ZM72 83.5977C81.1286 81.7444 87.9999 73.6754 88 64V60.0117L72 60.0078V83.5977ZM28.0039 60C28.0043 68.8776 32.827 76.6334 40 80.7852V60H28.0039ZM87.918 28.3242C92.9139 33.3813 96.0001 40.3297 96 48V52.0156H108V52C108 40.0801 99.3084 30.1954 87.918 28.3242ZM72 52.0078L88 52.0117V48C88.0001 38.3241 81.1291 30.2514 72 28.3984V52.0078ZM64 28.3984C54.8712 30.2516 48.0001 38.3245 48 48V52.0039L64 52.0078V28.3984ZM48.082 28.3203C37.0868 30.1261 28.607 39.4023 28.0312 50.7656L28 52H40V48C40.0001 40.329 43.085 33.3776 48.082 28.3203Z"
			fill="currentColor"
		/>
	</svg>
);

export const LocaleSelector: React.FC<LocaleSelectorProps> = ({
	position = "bottom-right",
	background,
	color,
	className = "",
	iconSize = 20,
	locales: localesProp,
	sortBy = "native",
}) => {
	const {
		locale,
		setLocale,
		availableLocales,
		getDisplayName,
		locales: localesFromContext,
	} = useVocoder();

	const locales = localesProp ?? localesFromContext;
	const normalizedPosition = POSITION_MAP[position] || position;
	const { vars: themeVars } = React.useMemo(() => resolveThemeOverrides(background, color), [
		background,
		color,
	]);

	const getDropdownProps = () => {
		switch (normalizedPosition) {
			case "top-left":   return { side: "bottom" as const, align: "start" as const };
			case "top-right":  return { side: "bottom" as const, align: "end" as const };
			case "bottom-left":return { side: "top" as const,    align: "start" as const };
			default:           return { side: "top" as const,    align: "end" as const };
		}
	};

	const { side, align } = getDropdownProps();

	const sortedLocales = React.useMemo(() => {
		if (!locales) return availableLocales;
		return [...availableLocales].sort((a, b) => {
			let nameA: string, nameB: string, compareLocale: string;
			switch (sortBy) {
				case "native":
					nameA = locales[a]?.nativeName || a;
					nameB = locales[b]?.nativeName || b;
					compareLocale = "en";
					break;
				case "translated":
					nameA = getDisplayName(a);
					nameB = getDisplayName(b);
					compareLocale = locale;
					break;
				default:
					nameA = getDisplayName(a, "en");
					nameB = getDisplayName(b, "en");
					compareLocale = "en";
			}
			return nameA.localeCompare(nameB, compareLocale, { sensitivity: "base" });
		});
	}, [availableLocales, locale, locales, sortBy, getDisplayName]);

	if (!isVocoderEnabled()) return null;

	const getPositionStyles = (): React.CSSProperties => {
		const base: React.CSSProperties = { position: "fixed", zIndex: 9999 };
		switch (normalizedPosition) {
			case "top-left":    return { ...base, top: "20px", left: "20px" };
			case "top-right":   return { ...base, top: "20px", right: "20px" };
			case "bottom-left": return { ...base, bottom: "20px", left: "20px" };
			default:            return { ...base, bottom: "20px", right: "20px" };
		}
	};

	// Default colors come from CSS (STYLES above). Explicit props override those
	// CSS variables, while JS-derived values preserve the soft border/fill recipe.
	const buttonStyles: LocaleSelectorThemeVars = {
		...themeVars,
		width: "48px",
		height: "48px",
		borderRadius: "50%",
		cursor: "pointer",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
		transition: "transform 0.2s ease, box-shadow 0.2s ease",
		borderWidth: "1px",
		borderStyle: "solid",
	};

	const contentStyles: LocaleSelectorThemeVars = {
		...themeVars,
		borderRadius: "8px",
		padding: "8px",
		minWidth: "200px",
		maxHeight: "400px",
		overflowY: "auto",
		boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
		borderWidth: "1px",
		borderStyle: "solid",
		zIndex: 10000,
	};

	const itemStyles: React.CSSProperties = {
		padding: "7px 12px",
		cursor: "pointer",
		borderRadius: "4px",
		fontSize: "14px",
		outline: "none",
		userSelect: "none",
	};

	return (
		<div style={getPositionStyles()} className={className}>
			<style>{STYLES}</style>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<button
						{...{ [TRIGGER_ATTR]: "" }}
						style={buttonStyles}
						onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
							e.currentTarget.style.transform = "scale(1.05)";
							e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
						}}
						onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
							e.currentTarget.style.transform = "scale(1)";
							e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
						}}
						aria-label="Select language"
					>
						<VocoderLogo size={iconSize} />
					</button>
				</DropdownMenu.Trigger>

				<DropdownMenu.Portal>
					<DropdownMenu.Content
						{...{ [CONTENT_ATTR]: "" }}
						style={contentStyles}
						side={side}
						align={align}
						sideOffset={8}
					>
						{sortedLocales.map((lang: string) => {
							const isActive = lang === locale;
							return (
								<DropdownMenu.Item
									key={lang}
									{...{ [ITEM_ATTR]: "" }}
									data-active={isActive ? "true" : "false"}
									style={itemStyles}
									onSelect={() => setLocale(lang)}
								>
									<div
										style={{
											display: "flex",
											alignItems: "center",
											justifyContent: "space-between",
										}}
									>
										<span>{locales?.[lang]?.nativeName || lang}</span>
										{isActive && (
											<span style={{ marginLeft: "8px", fontSize: "12px" }}>
												✓
											</span>
										)}
									</div>
								</DropdownMenu.Item>
							);
						})}
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		</div>
	);
};
