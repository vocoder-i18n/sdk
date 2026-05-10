/**
 * @module plan-check
 *
 * Workspace plan limit enforcement for the init command.
 * Scenarios:
 *   - At limit: prompt to upgrade, open browser to subscription settings, exit.
 *   - Near limit: return remaining slot count so the app-dir selector can cap input.
 *   - API failure: warn and continue — the server enforces limits on creation too.
 *   - Plan limit error from server POST: detect via message text, show upgrade URL.
 *
 * Exports: checkPlanLimits, isPlanLimitFailure, printPlanLimitMessage, getSubscriptionSettingsUrl
 */

import * as p from "@clack/prompts";
import chalk from "chalk";
import type { VocoderAPI } from "./api.js";
import { tryOpenBrowser } from "./browser.js";

const SUBSCRIPTION_SETTINGS_PATH =
	"/dashboard/workspace/settings?tab=subscription";

/** Constructs the absolute URL for the workspace subscription settings page. */
export function getSubscriptionSettingsUrl(apiUrl: string): string {
	return new URL(SUBSCRIPTION_SETTINGS_PATH, apiUrl).toString();
}

/** Returns true when a server error message indicates a plan limit was hit. */
export function isPlanLimitFailure(message?: string): boolean {
	if (!message) return false;
	return /limit|upgrade/i.test(message);
}

/** Logs a plan limit error and the subscription settings URL for upgrading. */
export function printPlanLimitMessage(apiUrl: string, message: string): void {
	p.log.error(`You are over your plan limits.\n   ${message}`);
	p.log.info(`Manage subscription: ${getSubscriptionSettingsUrl(apiUrl)}`);
}

export interface PlanCheckResult {
	/** True when the workspace is at or over its app limit. */
	atLimit: boolean;
	/** Remaining app slots, or undefined when the plan has no limit (-1). */
	remaining?: number;
}

/**
 * Fetches plan limits for the selected organization and enforces them
 * interactively. Returns `{ atLimit: true }` if the user was at limit and
 * chose to cancel, or `{ atLimit: false, remaining }` to continue.
 *
 * On API failure, warns and returns `{ atLimit: false }` — the server will
 * re-enforce the limit on project creation.
 */
export async function checkPlanLimits(
	api: VocoderAPI,
	userToken: string,
	organizationId: string,
	apiUrl: string,
): Promise<PlanCheckResult> {
	try {
		const { organizations } = await api.listOrganizations(userToken);
		const organization = organizations.find((o) => o.id === organizationId);

		if (!organization) {
			return { atLimit: false };
		}

		if (organization.maxApps !== -1 && organization.appCount >= organization.maxApps) {
			p.log.warn(
				`App limit reached — ${organization.appCount}/${organization.maxApps} on your ${chalk.bold(organization.planId)} plan.`,
			);

			const limitAction = await p.select<string>({
				message: "What would you like to do?",
				options: [
					{ value: "upgrade", label: "Upgrade plan" },
					{ value: "cancel", label: "Cancel" },
				],
			});

			if (p.isCancel(limitAction) || limitAction === "cancel") {
				p.cancel("Setup cancelled.");
				return { atLimit: true };
			}

			await tryOpenBrowser(getSubscriptionSettingsUrl(apiUrl));
			p.cancel("Upgrade your plan in the browser, then re-run `vocoder init`.");
			return { atLimit: true };
		}

		const remaining =
			organization.maxApps === -1
				? undefined
				: Math.max(0, organization.maxApps - organization.appCount);

		return { atLimit: false, remaining };
	} catch {
		p.log.warn(
			"Could not verify plan limits — proceeding, the server will enforce them.",
		);
		return { atLimit: false };
	}
}
