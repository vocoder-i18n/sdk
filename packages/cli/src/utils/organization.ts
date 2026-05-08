import * as p from "@clack/prompts";
import chalk from "chalk";

export interface OrganizationInfo {
	id: string;
	name: string;
	planId: string;
	projectCount: number;
	hasGitHubConnection: boolean;
	connectionLabel: string | null;
}

export interface OrganizationListResult {
	organizations: OrganizationInfo[];
	canCreateOrganization: boolean;
}

export type OrganizationSelection =
	| { action: "use"; organization: OrganizationInfo }
	| { action: "create" }
	| { action: "cancelled" };

function _organizationLabel(org: OrganizationInfo): string {
	const parts: string[] = [org.name];
	const meta: string[] = [];

	if (org.projectCount === 1) {
		meta.push("1 project");
	} else if (org.projectCount > 1) {
		meta.push(`${org.projectCount} projects`);
	}

	if (org.connectionLabel) {
		meta.push(`GitHub: ${org.connectionLabel}`);
	}

	if (meta.length > 0) {
		parts.push(chalk.dim(`(${meta.join(", ")})`));
	}

	return parts.join(" ");
}

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
		organizations.map((org) => ({
			value: org.id,
			label: org.name,
			hint:
				[
					org.projectCount > 0
						? `${org.projectCount} project${org.projectCount !== 1 ? "s" : ""}`
						: "",
					org.connectionLabel ? `GitHub: ${org.connectionLabel}` : "",
				]
					.filter(Boolean)
					.join(" · ") || undefined,
		}));

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
