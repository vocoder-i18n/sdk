/**
 * @module organization-select
 *
 * Organization (workspace) resolution for `vocoder init`. Vocoder-account auth
 * only — no GitHub App / OAuth / discovery flows. Lists the user's
 * organizations and either auto-selects the only one, prompts to pick from
 * many, or errors out when the user belongs to none.
 *
 * Exports: selectOrganizationForInit
 */

import * as p from "@clack/prompts";
import type { CommandSession } from "./command-session.js";
import type { VocoderAPI } from "./api.js";
import { highlight } from "./theme.js";
import { promptTextInput } from "./prompt-text.js";

export interface SelectOrganizationParams {
	api: VocoderAPI;
	session: CommandSession;
	userToken: string;
	options: { yes?: boolean };
	/** Pre-fill for the workspace name prompt when no orgs exist (e.g. git owner slug). */
	suggestedName?: string;
}

export interface SelectOrganizationResult {
	organizationId: string;
	organizationName: string;
}

/**
 * Resolves which organization to use for project creation. Returns the
 * selected organization, or null on cancellation / no orgs.
 */
export async function selectOrganizationForInit(
	params: SelectOrganizationParams,
): Promise<SelectOrganizationResult | null> {
	const { api, session, userToken, suggestedName } = params;

	const { organizations, canCreateOrganization } = await api.listOrganizations(userToken);

	if (organizations.length === 0) {
		if (!canCreateOrganization) {
			session.fail(
				"You're not a member of any workspace.",
				["Create one at https://vocoder.app, then run vocoder init again."],
			);
			return null;
		}

		const name = await promptTextInput({
			message: "Workspace name",
			placeholder: "My Workspace",
			initialValue: suggestedName,
			confirmLabel: "Workspace",
			validate: (value) => (value.trim() ? undefined : "Name is required"),
		});
		if (!name) return null;

		const created = await api.createOrganization(userToken, { name });
		return { organizationId: created.organizationId, organizationName: created.name };
	}

	if (organizations.length === 1) {
		const organization = organizations[0]!;
		session.step("Workspace", highlight(organization.name));
		return { organizationId: organization.id, organizationName: organization.name };
	}

	const choice = await p.select<string>({
		message: "Select workspace",
		options: organizations.map((o) => ({
			value: o.id,
			label: o.name,
			hint: `${o.appCount} app${o.appCount !== 1 ? "s" : ""}`,
		})),
	});

	if (p.isCancel(choice)) {
		p.cancel("Setup cancelled.");
		return null;
	}

	const organization = organizations.find((o) => o.id === choice)!;
	session.step("Workspace", highlight(organization.name));
	return { organizationId: organization.id, organizationName: organization.name };
}
