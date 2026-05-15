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
		expect(lines).toHaveLength(2);
		expect(lines.join(" ")).toContain("DeepL");
		expect(lines[1]).toContain("settings");
	});

	it("returns source string guidance combining current and required on one line", () => {
		const lines = getLimitErrorGuidance(createLimitError("source_strings"));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("10");
		expect(lines[0]).toContain("20");
		expect(lines[1]).toContain("Upgrade");
	});

	it("returns locale limit guidance with planId and upgrade URL", () => {
		const lines = getLimitErrorGuidance(createLimitError("target_locales"));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("free");
		expect(lines[1]).toContain("Upgrade");
	});

	it("fallback combines planId/current/required on one line + upgrade URL", () => {
		const lines = getLimitErrorGuidance(createLimitError("projects"));
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain("free");
		expect(lines[0]).toContain("10");
		expect(lines[0]).toContain("20");
	});
});
