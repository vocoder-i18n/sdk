import { randomUUID } from "node:crypto";
import { detectRepoIdentity } from "@vocoder/plugin";
import {
	VocoderAPI,
	VocoderAPIError,
	writeAuthData,
	verifyStoredAuth,
} from "@vocoder/cli/lib";

export interface InitStartInput {
	mode?: "install" | "link";
}

export interface ExistingApp {
	appDir: string;
	appId: string;
	projectId: string;
	projectName: string;
}

export interface InitStartResult {
	authUrl: string | null;
	sessionId: string;
	expiresAt: string;
	mode: "install" | "link" | "existing";
	existingApps: ExistingApp[];
	instructions: string;
}

export interface InitCompleteInput {
	sessionId: string;
}

export interface InitCompleteResult {
	authenticated: true;
	email: string;
	instructions: string;
}

export interface ProjectCreateInput {
	sessionId: string;
	sourceLocale: string;
	targetLocales: string[];
	targetBranches: string[];
	projectName?: string;
}

export interface ProjectCreateResult {
	apiKey: string;
	projectName: string;
	sourceLocale: string;
	targetLocales: string[];
	targetBranches: string[];
	repositoryBound: boolean;
	configureUrl?: string;
	apps: Array<{ appDir: string; appId: string }>;
	instructions: string;
}

interface PendingSession {
	sessionId: string;
	apiUrl: string;
	repoCanonical?: string;
	repoAppDir?: string;
	mode: "install" | "link" | "existing";
	// Set when a valid stored auth token was found — skips browser polling entirely
	storedToken?: string;
	// Populated after vocoder_init_complete — used by vocoder_project_create
	resolvedToken?: string;
	// organizationId returned by the install callback — workspace already created, skip claim
	pollOrganizationId?: string;
}

// Survives for the lifetime of the MCP server process — one session at a time is fine
const pendingSessions = new Map<string, PendingSession>();

const POLL_INTERVAL_MS = 2000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function runInitStart(
	input: InitStartInput,
): Promise<InitStartResult> {
	const apiUrl = process.env.VOCODER_API_URL || "https://vocoder.app";
	const identity = detectRepoIdentity();
	const expiresAt = new Date(Date.now() + AUTH_TIMEOUT_MS).toISOString();

	const api = new VocoderAPI({ apiUrl, apiKey: "" });

	// Anonymous repo lookup — mirrors CLI step 2. Runs before auth so we can
	// surface existing apps to the agent without requiring a browser flow.
	let existingApps: ExistingApp[] = [];
	if (identity) {
		try {
			const lookup = await api.lookupAppByRepo({
				repoCanonical: identity.repoCanonical,
				appDir: identity.appDir ?? "",
			});
			existingApps = lookup.existingApps ?? [];
		} catch {
			// Non-fatal — proceed without lookup data
		}
	}

	// Check stored auth using the same logic as the CLI (shared via @vocoder/cli/lib).
	// verifyStoredAuth distinguishes three cases:
	// - "valid":   token still good — skip browser flow entirely
	// - "expired": token rejected but user record exists — reauth via verificationUrl
	//              (same as CLI reauth=true: no new org, no new GitHub App install)
	// - "gone":    404, user deleted — treat as first-time, use installUrl
	// - "none":    no stored token — first-time, use installUrl
	const storedAuth = await verifyStoredAuth(api);

	const existingNote =
		existingApps.length > 0
			? ` This repo already has ${existingApps.length} configured app(s): ${existingApps.map((a) => a.projectName).join(", ")}. Proceeding will add a new app or re-authenticate.`
			: "";

	if (storedAuth.status === "valid") {
		const sessionId = randomUUID();
		pendingSessions.set(sessionId, {
			sessionId,
			apiUrl,
			repoCanonical: identity?.repoCanonical,
			repoAppDir: identity?.appDir,
			mode: "existing",
			storedToken: storedAuth.token,
		});
		return {
			authUrl: null,
			sessionId,
			expiresAt,
			mode: "existing",
			existingApps,
			instructions: `Already authenticated as ${storedAuth.email} — no browser flow needed.${existingNote} Call vocoder_init_complete with the sessionId to confirm, then collect project config.`,
		};
	}

	const session = await api.startCliAuthSession(undefined, identity?.repoCanonical);

	// Mirror the CLI reauth logic exactly:
	// - expired token → verificationUrl (user has an account, just sign in again —
	//   no GitHub App install, no new org created)
	// - gone/none → installUrl (first-time: GitHub App install + auth in one trip)
	const isReauth = storedAuth.status === "expired";
	const mode = input.mode ?? "install";

	let authUrl: string;
	if (isReauth) {
		// Reauth: use the verification URL just like the CLI does — avoids creating
		// a duplicate workspace for a returning user with an expired token.
		authUrl = session.verificationUrl;
	} else if (mode === "link") {
		try {
			const linkSession = await api.startCliGitHubLinkSession(session.sessionId);
			authUrl = linkSession.oauthUrl;
		} catch {
			authUrl = session.installUrl ?? session.verificationUrl;
		}
	} else {
		authUrl = session.installUrl ?? session.verificationUrl;
	}

	pendingSessions.set(session.sessionId, {
		sessionId: session.sessionId,
		apiUrl,
		repoCanonical: identity?.repoCanonical,
		repoAppDir: identity?.appDir,
		mode: isReauth ? "existing" : mode,
	});

	const modeNote = isReauth
		? "This URL just signs you back in — your existing workspace and GitHub connection are preserved."
		: mode === "link"
			? "This URL only requires GitHub authorization (no App install needed)."
			: "This URL installs the Vocoder GitHub App and authenticates in one step.";

	return {
		authUrl,
		sessionId: session.sessionId,
		expiresAt: session.expiresAt,
		mode,
		existingApps,
		instructions: `Ask the user to open this link to authenticate: [Authenticate with Vocoder](${authUrl})\n\n${modeNote}${existingNote}\n\nTell the user to reply when they've finished the browser flow. Wait for their confirmation — do nothing else until they confirm.`,
	};
}

// Polls for the auth token and writes auth.json. No workspace resolution — that
// happens in vocoder_project_create so re-runs don't hit "already claimed" errors.
export async function runInitComplete(
	input: InitCompleteInput,
): Promise<InitCompleteResult> {
	const session = pendingSessions.get(input.sessionId);
	if (!session) {
		throw new Error(
			`No pending session found for sessionId "${input.sessionId}". Call vocoder_init_start first.`,
		);
	}

	const api = new VocoderAPI({ apiUrl: session.apiUrl, apiKey: "" });

	let userToken: string;
	let pollOrganizationId: string | undefined;

	if (session.storedToken) {
		userToken = session.storedToken;
	} else {
		const deadline = Date.now() + AUTH_TIMEOUT_MS;
		let polledToken: string | null = null;

		while (Date.now() < deadline) {
			const result = await api.pollCliAuthSession(session.sessionId);

			if (result.status === "complete") {
				polledToken = result.token;
				// Install flow: organizationId comes back when GitHub App install + auth
				// completed in one browser trip. Pass it through to project_create so
				// we skip the workspace lookup entirely.
				if (result.organizationId) pollOrganizationId = result.organizationId;
				break;
			}

			if (result.status === "failed") {
				pendingSessions.delete(input.sessionId);
				throw new Error(
					`Authentication failed: ${result.reason}. Run vocoder_init_start again.`,
				);
			}

			await sleep(POLL_INTERVAL_MS);
		}

		if (!polledToken) {
			pendingSessions.delete(input.sessionId);
			throw new Error(
				"Authentication timed out after 5 minutes. Run vocoder_init_start again.",
			);
		}

		userToken = polledToken;
	}

	// Write auth.json immediately — same order as CLI, before anything else can fail.
	let userEmail = "";
	try {
		const userInfo = await api.getCliUserInfo(userToken);
		userEmail = userInfo.email;
		if (!session.storedToken) {
			writeAuthData({
				token: userToken,
				userId: userInfo.userId,
				email: userInfo.email,
				name: userInfo.name,
				createdAt: new Date().toISOString(),
			});
		}
	} catch {
		// Non-fatal
	}

	pendingSessions.set(input.sessionId, {
		...session,
		resolvedToken: userToken,
		pollOrganizationId,
	});

	return {
		authenticated: true,
		email: userEmail,
		instructions: `Authenticated. Now ask the user for: sourceLocale (e.g. "en"), targetLocales (e.g. ["es", "fr"]), targetBranches (e.g. ["main"]), and optional projectName. Then call vocoder_project_create.`,
	};
}

export async function runProjectCreate(
	input: ProjectCreateInput,
): Promise<ProjectCreateResult> {
	const session = pendingSessions.get(input.sessionId);
	if (!session?.resolvedToken) {
		throw new Error(
			`No authenticated session found for sessionId "${input.sessionId}". Call vocoder_init_complete first.`,
		);
	}

	const api = new VocoderAPI({ apiUrl: session.apiUrl, apiKey: "" });
	const userToken = session.resolvedToken;

	// Resolve organization — happens here (not in init_complete) so re-runs never hit
	// "already claimed" errors from claimCliGitHubInstallation.
	const organizationId = await resolveOrganization(api, userToken, session);

	const projectName =
		input.projectName ??
		session.repoCanonical?.split("/").pop() ??
		"my-project";

	let projectResult: Awaited<ReturnType<typeof api.createProject>>;
	try {
		projectResult = await api.createProject(userToken, {
			organizationId: organizationId,
			name: projectName,
			sourceLocale: input.sourceLocale,
			targetLocales: input.targetLocales,
			targetBranches: input.targetBranches,
			appDirs: session.repoAppDir ? [session.repoAppDir] : [],
			repoCanonical: session.repoCanonical,
		});
	} catch (err) {
		pendingSessions.delete(input.sessionId);
		const msg = err instanceof VocoderAPIError ? err.message : String(err);
		throw new Error(`Project creation failed: ${msg}`);
	}

	pendingSessions.delete(input.sessionId);

	const apps: Array<{ appDir: string; appId: string }> =
		(projectResult as typeof projectResult & { apps?: Array<{ appDir: string; appId: string }> }).apps ?? [];

	const configLines = apps.length > 0
		? apps.map((app) =>
				[
					`import { defineConfig } from '@vocoder/config';`,
					``,
					`export default defineConfig({`,
					`  appId: '${app.appId}',`,
					`  localesPath: 'src/locales',`,
					`  targetBranches: [${input.targetBranches.map((b) => `'${b}'`).join(", ")}],`,
					`});`,
				].join("\n"),
			)
		: [];

	const configInstructions =
		configLines.length > 0
			? `\n\n2. Write vocoder.config.ts${apps.length > 1 ? " per app directory" : ""}:\n${configLines.map((c, i) => (apps[i]?.appDir ? `   # ${apps[i]!.appDir}\n${c}` : c)).join("\n\n")}`
			: `\n\n2. Call vocoder_implement_i18n — it will generate vocoder.config.ts and the full SDK implementation plan.`;

	const repoWarning = !projectResult.repositoryBound
		? `\n\nWARNING: Repository not bound — translations won't run automatically until you grant the Vocoder GitHub App access to this repository in your GitHub installation settings.`
		: "";

	return {
		...projectResult,
		apps,
		instructions: [
			`App "${projectResult.projectName}" created. Next steps:`,
			``,
			`1. Write to .env at the project root:`,
			`   VOCODER_API_KEY=${projectResult.apiKey}`,
			configInstructions,
			``,
			`3. Call vocoder_implement_i18n to install packages, set up VocoderProvider, and get the list of files to wrap strings in.`,
			``,
			`4. Tell the user: add VOCODER_API_KEY=${projectResult.apiKey} to their MCP server environment config and restart their editor.`,
			repoWarning,
		]
			.join("\n")
			.trim(),
	};
}

// Resolves the organization ID to use for project creation.
// Order: poll callback organizationId → existing organization covering repo → claim unclaimed installation.
// Checking existing organizations first prevents "already claimed" errors on re-runs.
async function resolveOrganization(
	api: VocoderAPI,
	userToken: string,
	session: PendingSession,
): Promise<string> {
	// Install flow: organizationId already returned by the auth callback
	if (session.pollOrganizationId) {
		return session.pollOrganizationId;
	}

	// Check for an existing organization before trying to claim anything
	const organizationData = await api.listOrganizations(userToken, {
		repo: session.repoCanonical,
	});

	const covering = session.repoCanonical
		? organizationData.organizations.filter((w) => w.coversRepo === true)
		: [];

	if (covering.length === 1) return covering[0]!.id;
	if (covering.length === 0 && organizationData.organizations.length === 1)
		return organizationData.organizations[0]!.id;
	if (organizationData.organizations.length > 1) {
		// Multiple organizations — use the first one covering the repo if available,
		// otherwise the first organization overall. Ambiguity here requires human choice
		// which the MCP can't provide, but failing hard would block all re-runs.
		return (covering[0] ?? organizationData.organizations[0])!.id;
	}

	// No organization found — try to claim an unclaimed GitHub App installation
	if (session.mode === "link") {
		const discovery = await api.getCliGitHubDiscovery(userToken);
		const unclaimed = discovery.installations.filter(
			(i) => !i.isSuspended && !i.conflictLabel,
		);

		if (unclaimed.length === 0) {
			const all = discovery.installations.length;
			throw new Error(
				all === 0
					? "No GitHub App installations found. Install the Vocoder GitHub App first, then re-run vocoder_init_start with mode: 'install'."
					: "GitHub App installations found but all are already claimed. Complete setup at [vocoder.app/dashboard](https://vocoder.app/dashboard).",
			);
		}

		// Claim the first unclaimed installation (auto-select when only one)
		const claimResult = await api.claimCliGitHubInstallation(userToken, {
			installationId: String(unclaimed[0]!.installationId),
			organizationId: null,
		});
		return claimResult.organizationId;
	}

	throw new Error(
		"No organization found. The GitHub App installation may not have completed. " +
			"Try again or complete setup at [vocoder.app/dashboard](https://vocoder.app/dashboard).",
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
