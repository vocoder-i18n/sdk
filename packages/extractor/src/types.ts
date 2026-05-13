export interface ExtractedString {
	key: string;
	/** Source text. null for id-only entries (<T id="key" /> with no message or children). */
	text: string | null;
	file: string;
	line: number;
	context?: string;
	formality?: "formal" | "informal" | "auto";
	/** Detected UI role from JSX parent element or prop. e.g. "button_label", "heading", "input_placeholder" */
	uiRole?: string;
}
