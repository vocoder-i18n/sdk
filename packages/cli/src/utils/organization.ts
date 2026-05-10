import * as p from "@clack/prompts";
import chalk from "chalk";

export interface OrganizationInfo {
	id: string;
	name: string;
	planId: string;
	projectCount: number;
	/** Total app count across all projects. */
	appCount: number;
	/** Plan limit on total apps (-1 = unlimited). */
	maxApps: number;
	hasGitHubConnection: boolean;
	connectionLabel: string | null;
	/** True when this org's GitHub App installation covers the queried repo. Null when no repo was queried. */
	coversRepo: boolean | null;
	installationConfigureUrl: string | null;
}

export interface OrganizationListResult {
	organizations: OrganizationInfo[];
	canCreateOrganization: boolean;
}

export type OrganizationSelection =
	| { action: "use"; organization: OrganizationInfo }
	| { action: "create" }
	| { action: "cancelled" };

/**
 * Prompt the user to select an organization or create a new one.
 * Returns an `OrganizationSelection` describing what the user chose.
 */
export async function selectOrganization(
	result: OrganizationListResult,
): Promise<OrganizationSelection> {
	const { organizations, canCreateOrganization } = result;

	if (organizations.length === 0) {
		// No organizations — must create
		return { action: "create" };
	}

	type SelectValue = string | "create";

	const options: Array<{ value: SelectValue; label: string; hint?: string }> =
		organizations.map((org) => {
			const atLimit = org.maxApps !== -1 && org.appCount >= org.maxApps;
			const hint =
				[
					org.projectCount > 0
						? `${org.projectCount} app${org.projectCount !== 1 ? "s" : ""}`
						: "",
					org.connectionLabel ? `GitHub: ${org.connectionLabel}` : "",
					atLimit ? chalk.yellow(`${org.appCount}/${org.maxApps} apps — upgrade for more`) : "",
				]
					.filter(Boolean)
					.join(" · ") || undefined;
			return { value: org.id, label: org.name, hint };
		});

	if (canCreateOrganization) {
		options.push({ value: "create", label: "Create new workspace" });
	}

	const selected = await p.select<SelectValue>({
		message: "Select workspace",
		options,
	});

	if (p.isCancel(selected)) {
		return { action: "cancelled" };
	}

	if (selected === "create") {
		return { action: "create" };
	}

	const organization = organizations.find((org) => org.id === selected);
	if (!organization) {
		return { action: "cancelled" };
	}

	return { action: "use", organization };
}
