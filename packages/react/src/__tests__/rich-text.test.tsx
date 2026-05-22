import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { T } from "../T";
import { VocoderProvider } from "../VocoderProvider";

describe("Rich text formatting", () => {
	it("renders component placeholder", async () => {
		render(
			<VocoderProvider>
				<T
					message="Click <0>here</0> for help"
					components={[<a key="help" href="/help" className="help-link" />]}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			const link = screen.getByText("here");
			expect(link.tagName).toBe("A");
			expect(link).toHaveAttribute("href", "/help");
			expect(link).toHaveClass("help-link");
		});
	});

	it("translates component placeholder", async () => {
		document.cookie = "vocoder_locale=es; Path=/";

		render(
			<VocoderProvider>
				<T
					message="Click <0>here</0> for help"
					components={[<a key="ayuda" href="/ayuda" />]}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			const link = screen.getByText("aqui");
			expect(link.tagName).toBe("A");
			expect(link).toHaveAttribute("href", "/ayuda");
		});
	});

	it("supports multiple component placeholders", async () => {
		render(
			<VocoderProvider>
				<T
					message="Read our <0>Privacy Policy</0> and <1>Terms of Service</1>"
					components={[<a key="privacy" href="/privacy" />, <a key="terms" href="/terms" />]}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByText("Privacy Policy")).toHaveAttribute("href", "/privacy");
			expect(screen.getByText("Terms of Service")).toHaveAttribute("href", "/terms");
		});
	});

	it("supports function slot — receives translated children", async () => {
		render(
			<VocoderProvider>
				<T
					message="<0>Click here</0>"
					components={[(children) => <strong data-testid="fn-slot">{children}</strong>]}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			const el = screen.getByTestId("fn-slot");
			expect(el.tagName).toBe("STRONG");
			expect(el.textContent).toBe("Click here");
		});
	});

	it("supports sparse object form for components", async () => {
		render(
			<VocoderProvider>
				<T
					message="<0>A</0> and <2>B</2>"
					components={{ 0: <em data-testid="slot0" />, 2: <strong data-testid="slot2" /> }}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			expect(screen.getByTestId("slot0").tagName).toBe("EM");
			expect(screen.getByTestId("slot0").textContent).toBe("A");
			expect(screen.getByTestId("slot2").tagName).toBe("STRONG");
			expect(screen.getByTestId("slot2").textContent).toBe("B");
		});
	});

	it("promotes React elements from values prop to component slots", async () => {
		render(
			<VocoderProvider>
				<T
					message="Click {icon} to continue"
					values={{ icon: <span data-testid="icon-slot">★</span> }}
				/>
			</VocoderProvider>,
		);

		await waitFor(() => {
			const icon = screen.getByTestId("icon-slot");
			expect(icon.textContent).toBe("★");
		});
	});
});
