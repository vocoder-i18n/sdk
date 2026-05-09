import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";
import { T } from "../T";
import { VocoderProvider } from "../VocoderProvider";

describe("T component", () => {
	it("renders translated text", async () => {
		document.cookie = "vocoder_locale=es; Path=/";

		render(
			<VocoderProvider>
				<T>Hello, world!</T>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("Hola, mundo!")).toBeInTheDocument();
		});
	});

	it("interpolates variables", async () => {
		render(
			<VocoderProvider>
				<T message="Hello, {name}!" values={{ name: "John" }} />
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("Hello, John!")).toBeInTheDocument();
		});
	});

	it("uses message prop over children", async () => {
		render(
			<VocoderProvider>
				<T message="Hello, world!">Goodbye</T>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("Hello, world!")).toBeInTheDocument();
		});
		expect(screen.queryByText("Goodbye")).not.toBeInTheDocument();
	});

	it("falls back to source text when translation does not exist", async () => {
		render(
			<VocoderProvider>
				<T>Untranslated text</T>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("Untranslated text")).toBeInTheDocument();
		});
	});

	describe("format modes", () => {
		it("formats number mode", async () => {
			render(
				<VocoderProvider>
					<T format="number" value={1234.5} />
				</VocoderProvider>,
			);
			await waitFor(() => {
				expect(screen.getByText("1,234.5")).toBeInTheDocument();
			});
		});

		it("formats integer mode (rounds)", async () => {
			render(
				<VocoderProvider>
					<T format="integer" value={1234.9} />
				</VocoderProvider>,
			);
			await waitFor(() => {
				expect(screen.getByText("1,235")).toBeInTheDocument();
			});
		});

		it("formats percent mode", async () => {
			render(
				<VocoderProvider>
					<T format="percent" value={0.42} />
				</VocoderProvider>,
			);
			await waitFor(() => {
				expect(screen.getByText("42%")).toBeInTheDocument();
			});
		});

		it("formats compact mode", async () => {
			render(
				<VocoderProvider>
					<T format="compact" value={1500000} />
				</VocoderProvider>,
			);
			await waitFor(() => {
				expect(screen.getByText("1.5M")).toBeInTheDocument();
			});
		});

		it("formats currency mode", async () => {
			render(
				<VocoderProvider>
					<T format="currency" value={9.99} currency="USD" />
				</VocoderProvider>,
			);
			await waitFor(() => {
				const text = screen.getByText(/9\.99/);
				expect(text.textContent).toContain("$");
			});
		});

		it("formats date mode", async () => {
			const date = new Date("2024-01-15T12:00:00Z");
			render(
				<VocoderProvider>
					<T format="date" value={date} />
				</VocoderProvider>,
			);
			await waitFor(() => {
				// Jan 15, 2024 — locale-dependent format, check for year
				expect(screen.getByText(/2024/)).toBeInTheDocument();
			});
		});
	});
});
