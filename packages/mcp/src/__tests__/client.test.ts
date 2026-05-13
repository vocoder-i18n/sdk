import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VocoderAPI } from "@vocoder/cli/lib";
import { NO_API_KEY_MESSAGE, createClient } from "../client.js";

describe("NO_API_KEY_MESSAGE", () => {
	it("contains instructions to run init", () => {
		expect(NO_API_KEY_MESSAGE).toContain("VOCODER_API_KEY");
		expect(NO_API_KEY_MESSAGE).toContain("npx @vocoder/cli init");
	});
});

describe("createClient", () => {
	beforeEach(() => {
		delete process.env.VOCODER_API_KEY;
		delete process.env.VOCODER_API_URL;
	});

	afterEach(() => {
		delete process.env.VOCODER_API_KEY;
		delete process.env.VOCODER_API_URL;
	});

	it("returns null when VOCODER_API_KEY is not set", () => {
		expect(createClient()).toBeNull();
	});

	it("returns a VocoderAPI instance when VOCODER_API_KEY is set", () => {
		process.env.VOCODER_API_KEY = "vcp_test_key_123";
		const client = createClient();
		expect(client).toBeInstanceOf(VocoderAPI);
	});
});
