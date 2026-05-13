import type { VocoderTranslationData } from "@vocoder/core";

// Keys are FNV-1a 32-bit hashes of the source text (generateMessageHash).
const bundle: VocoderTranslationData = {
	config: {
		sourceLocale: "en",
		targetLocales: ["es", "fr", "pl"],
		locales: {
			en: {
				nativeName: "English",
				currencyCode: "USD",
				ordinalForms: {
					type: "suffix",
					suffixes: { one: "#st", two: "#nd", few: "#rd", other: "#th" },
				},
			},
			es: {
				nativeName: "Español",
				currencyCode: "EUR",
				ordinalForms: { type: "suffix", suffixes: { other: "#.º" } },
			},
			fr: {
				nativeName: "Français",
				currencyCode: "EUR",
				ordinalForms: {
					type: "suffix",
					suffixes: { one: "#er", other: "#e" },
				},
			},
			pl: { nativeName: "Polski", currencyCode: "PLN" },
		},
	},
	translations: {
		en: {
			"1w2u0qz": "Hello",
			"0x5nje8": "Goodbye",
			"1twzd04": "Hello, world!",
			"0yvn7bx": "Hello, {name}!",
			"0qy12rf": "You have {count} messages",
			"0bt5k53": "{count, plural, one {# item} other {# items}}",
			"1jkmkxh":
				"{count, plural, =0 {No items} one {# item} other {# items}}",
			"1ql9h40": "{count, selectordinal, other {#}}",
			"1uanpsy": "{value, select, male {his} female {her} other {their}}",
			"0x4ur6n":
				"{gender, select, male {He} female {She} other {They}} replied",
			"1fb9e3q": "Click <0>here</0> for help",
			"0og04vn":
				"Read our <0>Privacy Policy</0> and <1>Terms of Service</1>",
		},
		es: {
			"1w2u0qz": "Hola",
			"0x5nje8": "Adios",
			"1twzd04": "Hola, mundo!",
			"0yvn7bx": "Hola, {name}!",
			"0qy12rf": "Tienes {count} mensajes",
			"0bt5k53":
				"{count, plural, one {# articulo} other {# articulos}}",
			"1jkmkxh":
				"{count, plural, =0 {Sin articulos} one {# articulo} other {# articulos}}",
			"1ql9h40": "{count, selectordinal, other {#}}",
			"1uanpsy": "{value, select, male {su} female {su} other {su}}",
			"0x4ur6n":
				"{gender, select, male {El} female {Ella} other {Elle}} respondio",
			"1fb9e3q": "Haz clic <0>aqui</0> para obtener ayuda",
			"0og04vn":
				"Lee nuestra <0>Politica de Privacidad</0> y <1>Terminos de Servicio</1>",
		},
		fr: {
			"1w2u0qz": "Bonjour",
			"0x5nje8": "Au revoir",
			"1twzd04": "Bonjour, monde!",
			"0yvn7bx": "Bonjour, {name}!",
			"0qy12rf": "Vous avez {count} messages",
			"1jkmkxh":
				"{count, plural, =0 {Aucun article} one {# article} other {# articles}}",
			"0x4ur6n":
				"{gender, select, male {Il} female {Elle} other {Iel}} a repondu",
			"1fb9e3q": "Cliquez <0>ici</0> pour obtenir de l aide",
			"0og04vn":
				"Lisez notre <0>Politique de confidentialite</0> et nos <1>Conditions d utilisation</1>",
		},
		pl: {
			"1twzd04": "Czesc, swiecie!",
			"0bt5k53":
				"{count, plural, one {# przedmiot} few {# przedmioty} many {# przedmiotow} other {# przedmiotu}}",
		},
	},
	updatedAt: "2024-01-01T00:00:00.000Z",
};

export default bundle;
