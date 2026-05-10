/**
 * @module organization-select
 *
 * Organization (workspace) resolution for `vocoder init`. Handles all scenarios
 * a user may encounter when selecting which organization to create a project in:
 *
 *   1. Auth+install completed in one browser trip — org already known, skip selection.
 *   2. Repo already linked to an org via git connection — auto-select, skip GitHub steps.
 *   3. Exactly one org's GitHub App installation covers this repo — auto-select.
 *   4. Multiple orgs cover this repo — prompt user to pick one.
 *   5. Connected orgs exist but none cover this repo — surface fix options
 *      (configure existing install, or install on a different account).
 *   6. No connections — first-time user path: check cached installs → claim or
 *      run full discovery → select or create a new organization.
 *
 * Exports: selectOrganizationForInit
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { VocoderAPI } from "./api.js";
import {
	runGitHubDiscoveryFlow,
	runGitHubInstallFlow,
	selectGitHubInstallation,
} from "./github-connect.js";
import { tryOpenBrowser } from "./browser.js";
import { selectOrganization } from "./organization.js";

export interface SelectOrganizationParams {
	api: VocoderAPI;
	userToken: string;
	userEmail: string;
	/** Git identity from the current repo. Null when not in a git repo. */
	identity: { repoCanonical: string; repoRoot: string } | null;
	/** Result of the anonymous repo lookup performed before auth. */
	lookup: { organizationContext?: { organizationId: string; organizationName: string } | null } | null;
	/** Set when the repo already has a project — causes this function to skip straight to org resolution. */
	repoProjectId: string | null;
	/** Set when auth + GitHub install completed in one browser trip. */
	authOrganizationId?: string;
	options: { yes?: boolean };
}

export interface SelectOrganizationResult {
	organizationId: string;
	organizationName: string;
}

/**
 * Resolves which organization to use for project creation. Returns the selected
 * organization, or null if the user cancelled or an unrecoverable error occurred.
 */
export async function selectOrganizationForInit(
	params: SelectOrganizationParams,
): Promise<SelectOrganizationResult | null> {
	const { api, userToken, userEmail, identity, lookup, repoProjectId, options } = params;

	// ── Scenario 1: auth + install completed in one browser trip ─────────────────
	if (params.authOrganizationId) {
		const organizationData = await api.listOrganizations(userToken);
		const organization = organizationData.organizations.find(
			(o) => o.id === params.authOrganizationId,
		);
		const organizationName = organization?.name ?? userEmail;
		p.log.success(
			`Connected as ${chalk.bold(userEmail)} — workspace: ${chalk.bold(organizationName)}`,
		);
		return { organizationId: params.authOrganizationId, organizationName };
	}

	// ── Scenario 2: repo already linked to an org (git connection exists, no project yet) ──
	const repoOrgContext = identity ? (lookup?.organizationContext ?? null) : null;
	if (repoOrgContext && !repoProjectId) {
		p.log.success(`Workspace: ${chalk.bold(repoOrgContext.organizationName)}`);
		return {
			organizationId: repoOrgContext.organizationId,
			organizationName: repoOrgContext.organizationName,
		};
	}

	// ── Main path: resolve via org membership + GitHub installation state ─────────
	const organizationData = await api.listOrganizations(userToken, {
		repo: identity?.repoCanonical,
	});

	const repoCanonical = identity?.repoCanonical ?? null;
	const covering = repoCanonical
		? organizationData.organizations.filter((o) => o.coversRepo === true)
		: [];
	const connected = organizationData.organizations.filter(
		(o) => o.hasGitHubConnection,
	);

	if (repoCanonical && covering.length === 1) {
		// ── Scenario 3: exactly one org covers this repo — auto-select ───────────
		const organization = covering[0]!;
		p.log.success(`Workspace: ${chalk.bold(organization.name)}`);
		return { organizationId: organization.id, organizationName: organization.name };
	}

	if (repoCanonical && covering.length > 1) {
		// ── Scenario 4: multiple orgs cover this repo — prompt ───────────────────
		const choice = await p.select<string>({
			message: "Select workspace for this repo",
			options: covering.map((o) => ({
				value: o.id,
				label: `${o.name}  ${chalk.dim(`(${o.appCount} app${o.appCount !== 1 ? "s" : ""})`)}`,
			})),
		});
		if (p.isCancel(choice)) {
			p.cancel("Setup cancelled.");
			return null;
		}
		const organization = covering.find((o) => o.id === choice)!;
		p.log.success(`Workspace: ${chalk.bold(organization.name)}`);
		return { organizationId: organization.id, organizationName: organization.name };
	}

	if (repoCanonical && covering.length === 0 && connected.length > 0) {
		// ── Scenario 5: connected orgs exist but none cover this repo ────────────
		const shortRepo = repoCanonical.split(":")[1] ?? repoCanonical;
		p.log.warn(
			`${chalk.bold(shortRepo)} isn't accessible from your Vocoder installation.\n` +
				`  Grant access to this repository or install on the account that owns it.`,
		);

		const fixOptions: Array<{ value: string; label: string }> = [];
		for (const organization of connected) {
			if (organization.installationConfigureUrl) {
				fixOptions.push({
					value: `grant:${organization.id}`,
					label: `Configure ${chalk.bold(organization.connectionLabel ?? organization.name)}'s GitHub App installation`,
				});
			}
		}
		fixOptions.push({
			value: "install_new",
			label: `Install on a different GitHub account ${chalk.dim("(creates a new personal workspace)")}`,
		});
		fixOptions.push({ value: "cancel", label: "Cancel" });

		const fix = await p.select<string>({
			message: "How would you like to fix this?",
			options: fixOptions,
		});

		if (p.isCancel(fix) || fix === "cancel") {
			p.cancel("Setup cancelled.");
			return null;
		}

		if (fix.startsWith("grant:")) {
			const organization = connected.find((o) => `grant:${o.id}` === fix)!;
			await tryOpenBrowser(organization.installationConfigureUrl!);
			p.cancel(
				`Grant access to ${chalk.bold(shortRepo)} in your browser,\n` +
					`  then re-run ${chalk.bold("vocoder init")}.`,
			);
			return null;
		}

		// install_new: full install → creates new org covering the new account
		const connectResult = await runGitHubInstallFlow({
			api,
			userToken,
			yes: options.yes,
		});
		if (!connectResult) {
			p.log.error("GitHub App installation did not complete. Run `vocoder init` again.");
			return null;
		}
		p.log.success(`Workspace: ${chalk.bold(connectResult.organizationName)}`);
		return {
			organizationId: connectResult.organizationId,
			organizationName: connectResult.organizationName,
		};
	}

	// ── Scenario 6: fallback — no connections, first-time user path ──────────────
	// Only check cached GitHub App installs here (covering === 0 && connected === 0),
	// so claiming a cached installation can never error with "already connected".
	const discoveryResult = await api.getCliGitHubDiscovery(userToken).catch(() => null);
	const cachedInstallations = discoveryResult?.installations ?? [];

	if (cachedInstallations.length > 0) {
		if (repoCanonical) {
			const repoOwner = repoCanonical.split(":")[1]?.split("/")[0]?.toLowerCase();
			if (repoOwner) {
				const hasMatchingAccount = cachedInstallations.some(
					(i) => i.accountLogin.toLowerCase() === repoOwner,
				);
				if (!hasMatchingAccount) {
					p.log.warn(
						`None of your GitHub App installations belong to "${repoOwner}", ` +
							`the account that owns this repository.\n` +
							`  The project will be created but translations won't trigger automatically.\n` +
							`  To fix: install the Vocoder GitHub App on "${repoOwner}" instead.`,
					);
				}
			}
		}

		const validInstallations = cachedInstallations.filter(
			(i) => !i.isSuspended && !i.conflictLabel,
		);

		let selectedInstallationId: number | string | null = null;
		if (validInstallations.length === 1 && cachedInstallations.length === 1) {
			selectedInstallationId = validInstallations[0]!.installationId;
		} else {
			selectedInstallationId = await selectGitHubInstallation(
				cachedInstallations.map((inst) => ({
					installationId: inst.installationId,
					accountLogin: inst.accountLogin,
					accountType: inst.accountType,
					isSuspended: inst.isSuspended,
					conflictLabel: inst.conflictLabel,
				})),
				false,
			);
		}

		if (
			selectedInstallationId === null ||
			selectedInstallationId === "install_new"
		) {
			p.cancel("Setup cancelled. Re-run `vocoder init` and choose Install GitHub App.");
			return null;
		}

		const claimResult = await api.claimCliGitHubInstallation(userToken, {
			installationId: String(selectedInstallationId),
			organizationId: null,
		});
		p.log.success(`Workspace: ${chalk.bold(claimResult.organizationName)}`);
		return {
			organizationId: claimResult.organizationId,
			organizationName: claimResult.organizationName,
		};
	}

	if (
		organizationData.organizations.length === 1 &&
		!organizationData.canCreateOrganization
	) {
		const organization = organizationData.organizations[0]!;
		p.log.success(`Workspace: ${chalk.bold(organization.name)}`);
		return { organizationId: organization.id, organizationName: organization.name };
	}

	// Let user pick an existing org or trigger create-new flow
	const organizationResult = await selectOrganization(organizationData);

	if (organizationResult.action === "cancelled") {
		p.cancel("Setup cancelled.");
		return null;
	}

	if (organizationResult.action === "use") {
		const { organization } = organizationResult;
		p.log.success(`Workspace: ${chalk.bold(organization.name)}`);
		return { organizationId: organization.id, organizationName: organization.name };
	}

	// ── New workspace: GitHub connect flow ───────────────────────────────────────
	const connectChoice = await p.select<string>({
		message: "Connect your new workspace to GitHub",
		options: [
			{ value: "install", label: "Install the Vocoder GitHub App" },
			{ value: "link", label: "Link an existing installation" },
		],
	});

	if (p.isCancel(connectChoice)) {
		p.cancel("Setup cancelled.");
		return null;
	}

	if (connectChoice === "install") {
		const connectResult = await runGitHubInstallFlow({
			api,
			userToken,
			yes: options.yes,
		});
		if (!connectResult) {
			p.log.error("GitHub App installation did not complete. Run `vocoder init` again.");
			return null;
		}
		p.log.success(`Workspace: ${chalk.bold(connectResult.organizationName)}`);
		return {
			organizationId: connectResult.organizationId,
			organizationName: connectResult.organizationName,
		};
	}

	// "link" — run discovery to find existing installations
	const installations = await runGitHubDiscoveryFlow({
		api,
		userToken,
		yes: options.yes,
	});
	if (!installations) return null;

	if (installations.length === 0) {
		p.log.warn("No GitHub installations found. Install the Vocoder GitHub App first.");
		const installNow = await p.confirm({
			message: "Open GitHub to install the App?",
		});
		if (p.isCancel(installNow) || !installNow) return null;
		const connectResult = await runGitHubInstallFlow({
			api,
			userToken,
			yes: options.yes,
		});
		if (!connectResult) return null;
		p.log.success(`Workspace: ${chalk.bold(connectResult.organizationName)}`);
		return {
			organizationId: connectResult.organizationId,
			organizationName: connectResult.organizationName,
		};
	}

	const selectedInstallationId = await selectGitHubInstallation(
		installations.map((inst) => ({
			installationId: inst.installationId,
			accountLogin: inst.accountLogin,
			accountType: inst.accountType,
			isSuspended: inst.isSuspended,
			conflictLabel: inst.conflictLabel,
		})),
		true,
	);

	if (selectedInstallationId === null) {
		p.cancel("Setup cancelled.");
		return null;
	}

	if (selectedInstallationId === "install_new") {
		const connectResult = await runGitHubInstallFlow({
			api,
			userToken,
			yes: options.yes,
		});
		if (!connectResult) return null;
		p.log.success(`Workspace: ${chalk.bold(connectResult.organizationName)}`);
		return {
			organizationId: connectResult.organizationId,
			organizationName: connectResult.organizationName,
		};
	}

	const claimResult = await api.claimCliGitHubInstallation(userToken, {
		installationId: String(selectedInstallationId),
		organizationId: null,
	});
	p.log.success(`Workspace: ${chalk.bold(claimResult.organizationName)}`);
	return {
		organizationId: claimResult.organizationId,
		organizationName: claimResult.organizationName,
	};
}
