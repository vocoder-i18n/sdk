import { describe, expect, it } from "vitest";
import { getLimitErrorGuidance } from "../commands/translate.js";
import type { LimitErrorResponse } from "../types.js";

function createLimitError(
	limitType: LimitErrorResponse["limitType"],
): LimitErrorResponse {
	return {
		errorCode: "LIMIT_EXCEEDED",
		limitType,
		planId: "free",
		current: 10,
		required: 20,
		upgradeUrl:
			"https://vocoder.app/dashboard/organization/settings?tab=subscription",
		message: "Limit reached",
	};
}

describe("getLimitErrorGuidance", () => {
	it("returns provider setup guidance for providers limits", () => {
		const lines = getLimitErrorGuidance(createLimitError("providers"));
		expect(lines[0]).toContain("Provider setup required");
		expect(lines.join(" ")).toContain("DeepL API key");
	});

	it("returns source string guidance for source string limits", () => {
		const lines = getLimitErrorGuidance(createLimitError("source_strings"));
		expect(lines[0]).toContain("Active source string limit reached");
		expect(lines.join(" ")).toContain("Required for this sync");
	});

	it("returns locale limit guidance for target_locales limits", () => {
		const lines = getLimitErrorGuidance(createLimitError("target_locales"));
		expect(lines[0]).toContain("Current target locales");
		expect(lines.join(" ")).toContain("Upgrade plan");
	});

	it("keeps legacy guidance for generic plan limits", () => {
		const lines = getLimitErrorGuidance(createLimitError("projects"));
		expect(lines[0]).toBe("Plan: free");
		expect(lines[1]).toBe("Current: 10");
		expect(lines[2]).toBe("Required: 20");
	});
});
