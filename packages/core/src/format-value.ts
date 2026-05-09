import type { FormatMode } from "./types";

export interface FormatValueOptions {
	currency?: string;
	dateStyle?: "full" | "long" | "medium" | "short";
	timeStyle?: "full" | "long" | "medium" | "short";
}

const nfCache = new Map<string, Intl.NumberFormat>();
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getNF(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
	const key = `${locale}:${options.style ?? ""}:${options.currency ?? ""}:${options.notation ?? ""}:${options.maximumFractionDigits ?? ""}`;
	let fmt = nfCache.get(key);
	if (!fmt) {
		fmt = new Intl.NumberFormat(locale, options);
		nfCache.set(key, fmt);
	}
	return fmt;
}

function getDTF(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
	const key = `${locale}:${options.dateStyle ?? ""}:${options.timeStyle ?? ""}`;
	let fmt = dtfCache.get(key);
	if (!fmt) {
		fmt = new Intl.DateTimeFormat(locale, options);
		dtfCache.set(key, fmt);
	}
	return fmt;
}

export function formatValue(
	value: string | number | Date,
	format: FormatMode,
	locale: string,
	options: FormatValueOptions = {},
): string {
	const { currency, dateStyle = "medium", timeStyle = "short" } = options;
	const num = Number(value);
	const date = value instanceof Date ? value : new Date(value as string | number);

	switch (format) {
		case "number":
			return getNF(locale, {}).format(num);
		case "integer":
			return getNF(locale, { maximumFractionDigits: 0 }).format(num);
		case "percent":
			return getNF(locale, { style: "percent" }).format(num);
		case "compact":
			return getNF(locale, { notation: "compact" }).format(num);
		case "currency": {
			if (!currency) {
				if (process.env.NODE_ENV === "development") {
					console.warn('[vocoder] format="currency" requires a currency prop');
				}
				return String(value);
			}
			return getNF(locale, { style: "currency", currency }).format(num);
		}
		case "date":
			return getDTF(locale, { dateStyle }).format(date);
		case "time":
			return getDTF(locale, { timeStyle }).format(date);
		case "datetime":
			return getDTF(locale, { dateStyle, timeStyle }).format(date);
		default:
			return String(value);
	}
}
