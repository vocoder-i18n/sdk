import { beforeEach, describe, expect, it, vi } from "vitest";
import * as p from "@clack/prompts";
import {
	checkPlanLimits,
	getSubscriptionSettingsUrl,
	isPlanLimitFailure,
	printPlanLimitMessage,
} from "../utils/plan-check.js";

vi.mock("@clack/prompts", () => ({
	log: {
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
	select: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn((v) => v === Symbol.for("clack-cancel")),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
}));

vi.mock("../utils/browser.js", () => ({
	tryOpenBrowser: vi.fn().mockResolvedValue(false),
}));

function makeApi(organizations: object[]) {
	return {
		listOrganizations: vi.fn().mockResolvedValue({ organizations }),
	} as any;
}

function makeSession() {
	return {
		warn: vi.fn(),
		info: vi.fn(),
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
});

// ── isPlanLimitFailure ────────────────────────────────────────────────────────

describe("isPlanLimitFailure", () => {
	it("matches 'limit'", () => {
		expect(isPlanLimitFailure("App limit reached")).toBe(true);
	});

	it("matches 'upgrade'", () => {
		expect(isPlanLimitFailure("Please upgrade your plan")).toBe(true);
	});

	it("matches mixed case", () => {
		expect(isPlanLimitFailure("LIMIT exceeded")).toBe(true);
		expect(isPlanLimitFailure("UPGRADE required")).toBe(true);
	});

	it("rejects unrelated messages", () => {
		expect(isPlanLimitFailure("Network error")).toBe(false);
		expect(isPlanLimitFailure("Project created")).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isPlanLimitFailure(undefined)).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isPlanLimitFailure("")).toBe(false);
	});
});

// ── getSubscriptionSettingsUrl ────────────────────────────────────────────────

describe("getSubscriptionSettingsUrl", () => {
	it("constructs correct URL from apiUrl", () => {
		const url = getSubscriptionSettingsUrl("https://vocoder.app");
		expect(url).toBe(
			"https://vocoder.app/dashboard/workspace/settings?tab=subscription",
		);
	});

	it("handles apiUrl with trailing slash", () => {
		const url = getSubscriptionSettingsUrl("https://vocoder.app/");
		expect(url).toBe(
			"https://vocoder.app/dashboard/workspace/settings?tab=subscription",
		);
	});
});

// ── printPlanLimitMessage ────────────────────────────────────────────────────

describe("printPlanLimitMessage", () => {
	it("logs error and subscription URL", () => {
		printPlanLimitMessage("https://vocoder.app", "App limit reached");
		expect(p.log.error).toHaveBeenCalledWith(
			expect.stringContaining("App limit reached"),
		);
		expect(p.log.info).toHaveBeenCalledWith(
			expect.stringContaining("https://vocoder.app/dashboard/workspace/settings"),
		);
	});
});

// ── checkPlanLimits ───────────────────────────────────────────────────────────

describe("checkPlanLimits", () => {
	it("returns atLimit=false with remaining count when under limit", async () => {
		const api = makeApi([
			{ id: "org-1", appCount: 1, maxApps: 5, planId: "starter" },
		]);
		const result = await checkPlanLimits(api, makeSession(), "token", "org-1", "https://vocoder.app");
		expect(result).toEqual({ atLimit: false, remaining: 4 });
	});

	it("returns remaining=undefined when plan has no limit (-1)", async () => {
		const api = makeApi([
			{ id: "org-1", appCount: 10, maxApps: -1, planId: "pro" },
		]);
		const result = await checkPlanLimits(api, makeSession(), "token", "org-1", "https://vocoder.app");
		expect(result).toEqual({ atLimit: false, remaining: undefined });
	});

	it("returns atLimit=true and cancels when user chooses cancel at limit", async () => {
		const api = makeApi([
			{ id: "org-1", appCount: 2, maxApps: 2, planId: "free" },
		]);
		vi.mocked(p.select).mockResolvedValue("cancel");
		const result = await checkPlanLimits(api, makeSession(), "token", "org-1", "https://vocoder.app");
		expect(result).toEqual({ atLimit: true });
		expect(p.cancel).toHaveBeenCalled();
	});

	it("returns atLimit=true when user chooses upgrade at limit", async () => {
		const api = makeApi([
			{ id: "org-1", appCount: 2, maxApps: 2, planId: "free" },
		]);
		vi.mocked(p.select).mockResolvedValue("upgrade");
		const session = makeSession();
		const result = await checkPlanLimits(api, session, "token", "org-1", "https://vocoder.app");
		expect(result).toEqual({ atLimit: true });
		expect(session.info).toHaveBeenCalled();
	});

	it("warns and returns atLimit=false when API throws", async () => {
		const api = {
			listOrganizations: vi.fn().mockRejectedValue(new Error("Network error")),
		} as any;
		const session = makeSession();
		const result = await checkPlanLimits(api, session, "token", "org-1", "https://vocoder.app");
		expect(result).toEqual({ atLimit: false });
		expect(session.warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not verify plan limits"),
		);
	});

	it("returns atLimit=false when org not found in list", async () => {
		const api = makeApi([{ id: "org-other", appCount: 0, maxApps: 5, planId: "starter" }]);
		const result = await checkPlanLimits(api, makeSession(), "token", "org-1", "https://vocoder.app");
		expect(result).toEqual({ atLimit: false });
	});
});
