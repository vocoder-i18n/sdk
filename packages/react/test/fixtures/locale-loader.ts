import en from "./locales/en.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import pl from "./locales/pl.json";

const localeData: Record<string, Record<string, string>> = { en, es, fr, pl };

export async function loadLocale(locale: string): Promise<Record<string, string>> {
	return localeData[locale] ?? {};
}
