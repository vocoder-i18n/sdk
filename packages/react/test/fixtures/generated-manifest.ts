// Keys are FNV-1a 32-bit hashes of the source text (generateMessageHash).
// Must match the hash function in src/hash.ts — update both together.
// Component placeholder format is <N> (numeric, style). Old <cN> keys removed.
const translations = {
	en: {
		"1w2u0qz": "Hello",
		"0x5nje8": "Goodbye",
		"1twzd04": "Hello, world!",
		"0yvn7bx": "Hello, {name}!",
		"0qy12rf": "You have {count} messages",
		"0bt5k53": "{count, plural, one {# item} other {# items}}",
		"1jkmkxh": "{count, plural, =0 {No items} one {# item} other {# items}}",
		"1ql9h40": "{count, selectordinal, other {#}}", // DEFAULT_ORDINAL_ICU (locale-neutral; ordinals served via Tier 1 ordinalForms)
		"1uanpsy": "{value, select, male {his} female {her} other {their}}",
		"0x4ur6n": "{gender, select, male {He} female {She} other {They}} replied",
		"1fb9e3q": "Click <0>here</0> for help",
		"0og04vn": "Read our <0>Privacy Policy</0> and <1>Terms of Service</1>",
	},
	es: {
		"1w2u0qz": "Hola",
		"0x5nje8": "Adios",
		"1twzd04": "Hola, mundo!",
		"0yvn7bx": "Hola, {name}!",
		"0qy12rf": "Tienes {count} mensajes",
		"0bt5k53": "{count, plural, one {# articulo} other {# articulos}}",
		"1jkmkxh": "{count, plural, =0 {Sin articulos} one {# articulo} other {# articulos}}",
		"1ql9h40": "{count, selectordinal, other {#}}", // DEFAULT_ORDINAL_ICU; ES ordinal via Tier 1 ordinalForms
		"1uanpsy": "{value, select, male {su} female {su} other {su}}",
		"0x4ur6n": "{gender, select, male {El} female {Ella} other {Elle}} respondio",
		"1fb9e3q": "Haz clic <0>aqui</0> para obtener ayuda",
		"0og04vn": "Lee nuestra <0>Politica de Privacidad</0> y <1>Terminos de Servicio</1>",
	},
	fr: {
		"1w2u0qz": "Bonjour",
		"0x5nje8": "Au revoir",
		"1twzd04": "Bonjour, monde!",
		"0yvn7bx": "Bonjour, {name}!",
		"0qy12rf": "Vous avez {count} messages",
		"1jkmkxh": "{count, plural, =0 {Aucun article} one {# article} other {# articles}}",
		"0x4ur6n": "{gender, select, male {Il} female {Elle} other {Iel}} a repondu",
		"1fb9e3q": "Cliquez <0>ici</0> pour obtenir de l aide",
		"0og04vn": "Lisez notre <0>Politique de confidentialite</0> et nos <1>Conditions d utilisation</1>",
	},
	// Polish: tests CLDR few (2-4) and many (5+) plural categories
	pl: {
		"1twzd04": "Czesc, swiecie!",
		"0bt5k53": "{count, plural, one {# przedmiot} few {# przedmioty} many {# przedmiotow} other {# przedmiotu}}",
	},
} as const;

export const config = {
	sourceLocale: "en",
	targetLocales: ["es", "fr", "pl"],
	locales: {
		en: { nativeName: "English",  currencyCode: "USD",
			ordinalForms: { type: "suffix" as const, suffixes: { one: "#st", two: "#nd", few: "#rd", other: "#th" } } },
		es: { nativeName: "Espanol",  currencyCode: "EUR",
			ordinalForms: { type: "suffix" as const, suffixes: { other: "#.\u00ba" } } },
		fr: { nativeName: "Francais", currencyCode: "EUR",
			ordinalForms: { type: "suffix" as const, suffixes: { one: "#er", other: "#e" } } },
		pl: { nativeName: "Polski",   currencyCode: "PLN" },
	},
};

export const loaders = {
	en: () => Promise.resolve({ default: translations.en }),
	es: () => Promise.resolve({ default: translations.es }),
	fr: () => Promise.resolve({ default: translations.fr }),
	pl: () => Promise.resolve({ default: translations.pl }),
};

export default { config, loaders };
