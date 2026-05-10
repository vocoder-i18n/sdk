import { beforeEach, describe, expect, it, vi } from "vitest";
import * as p from "@clack/prompts";
import { selectOrganizationForInit } from "../utils/organization-select.js";

vi.mock("@clack/prompts", () => ({
	log: { success: vi.fn(), error: vi.fn() },
	select: vi.fn(),
	cancel: vi.fn(),
	isCancel: vi.fn((v) => v === Symbol.for("clack-cancel")),
}));

const CANCEL = Symbol.for("clack-cancel");

function makeOrg(id: string, name: string, appCount = 0) {
	return {
		id,
		name,
		planId: "free",
		maxApps: -1,
		appCount,
		hasGitHubConnection: false,
		connectionLabel: null,
		coversRepo: null,
		installationConfigureUrl: null,
	};
}

function makeApi(organizations: ReturnType<typeof makeOrg>[]) {
	return {
		listOrganizations: vi
			.fn()
			.mockResolvedValue({ organizations, canCreateOrganization: false }),
	} as unknown as Parameters<typeof selectOrganizationForInit>[0]["api"];
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("selectOrganizationForInit", () => {
	it("returns null and logs an error when the user has 0 organizations", async () => {
		const api = makeApi([]);

		const result = await selectOrganizationForInit({
			api,
			userToken: "tok",
			options: {},
		});

		expect(result).toBeNull();
		expect(p.log.error).toHaveBeenCalledWith(
			expect.stringContaining("not a member of any workspace"),
		);
		expect(p.select).not.toHaveBeenCalled();
	});

	it("auto-selects the only organization without prompting", async () => {
		const api = makeApi([makeOrg("org-1", "Acme")]);

		const result = await selectOrganizationForInit({
			api,
			userToken: "tok",
			options: {},
		});

		expect(result).toEqual({ organizationId: "org-1", organizationName: "Acme" });
		expect(p.select).not.toHaveBeenCalled();
	});

	it("prompts the user to pick when multiple organizations exist", async () => {
		const api = makeApi([
			makeOrg("org-1", "Acme", 3),
			makeOrg("org-2", "Globex", 1),
		]);
		vi.mocked(p.select).mockResolvedValue("org-2");

		const result = await selectOrganizationForInit({
			api,
			userToken: "tok",
			options: {},
		});

		expect(result).toEqual({
			organizationId: "org-2",
			organizationName: "Globex",
		});
		expect(p.select).toHaveBeenCalledOnce();
	});

	it("returns null when the user cancels the multi-org prompt", async () => {
		const api = makeApi([makeOrg("org-1", "Acme"), makeOrg("org-2", "Globex")]);
		vi.mocked(p.select).mockResolvedValue(CANCEL as unknown as string);

		const result = await selectOrganizationForInit({
			api,
			userToken: "tok",
			options: {},
		});

		expect(result).toBeNull();
		expect(p.cancel).toHaveBeenCalled();
	});
});
