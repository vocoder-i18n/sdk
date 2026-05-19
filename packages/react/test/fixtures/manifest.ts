import type { LocaleManifest } from "../../src/types";

const manifest: LocaleManifest = {
	version: 1,
	sourceLocale: "en",
	targetLocales: ["es", "fr", "pl"],
	locales: {
		en: {
			nativeName: "English",
			currencyCode: "USD",
			isRTL: false,
			ordinalForms: {
				type: "suffix",
				suffixes: { one: "#st", two: "#nd", few: "#rd", other: "#th" },
			},
		},
		es: {
			nativeName: "Español",
			currencyCode: "EUR",
			isRTL: false,
			ordinalForms: { type: "suffix", suffixes: { other: "#.º" } },
		},
		fr: {
			nativeName: "Français",
			currencyCode: "EUR",
			isRTL: false,
			ordinalForms: { type: "suffix", suffixes: { one: "#er", other: "#e" } },
		},
		pl: {
			nativeName: "Polski",
			currencyCode: "PLN",
			isRTL: false,
		},
	},
	updatedAt: "2024-01-01T00:00:00.000Z",
	fingerprint: "test-fingerprint",
};

export default manifest;
