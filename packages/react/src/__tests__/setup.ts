import "@testing-library/jest-dom";
import { beforeEach } from "vitest";
import { vocoder } from "@vocoder/core";
import fixtureManifest from "../../test/fixtures/manifest";
import { loadLocale as fixtureLoader } from "../../test/fixtures/locale-loader";

beforeEach(() => {
	// Reset singleton state and reload fixture data so each test starts clean.
	vocoder._reset();
	vocoder.load(fixtureManifest, fixtureLoader);
	// Clear stored locale cookie
	document.cookie = "vocoder_locale=; Path=/; Max-Age=0";
});
