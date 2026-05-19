import type { VocoderAPI } from "./api.js";

type RepoLookupResult = Awaited<ReturnType<VocoderAPI["lookupAppByRepo"]>>;

export interface ResolvedLookupMatch {
	kind: "exact" | "whole-repo";
	appDir: string;
	projectId: string;
	projectName: string;
	organizationName: string;
	sourceLocale?: string;
	targetBranches?: string[];
}

export function resolveLookupMatch(
	lookup: RepoLookupResult,
	currentAppDir: string,
): ResolvedLookupMatch | null {
	if (lookup.exactMatch) {
		return {
			kind: "exact",
			appDir: currentAppDir,
			projectId: lookup.exactMatch.projectId,
			projectName: lookup.exactMatch.projectName,
			organizationName: lookup.exactMatch.organizationName,
			sourceLocale: lookup.exactMatch.sourceLocale,
			targetBranches: lookup.exactMatch.targetBranches,
		};
	}

	if (!lookup.hasWholeRepoApp) {
		return null;
	}

	const rootApp = lookup.existingApps.find((app) => app.appDir === "") ?? lookup.existingApps[0];
	if (!rootApp) {
		return null;
	}

	return {
		kind: "whole-repo",
		appDir: "",
		projectId: rootApp.projectId,
		projectName: rootApp.projectName,
		organizationName: rootApp.organizationName,
	};
}
