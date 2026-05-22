import { randomUUID } from "node:crypto";
import { detectRepoIdentity } from "@vocoder/cli/lib";
import {
	VocoderAPI,
	VocoderAPIError,
	writeAuthData,
	verifyStoredAuth,
} from "@vocoder/cli/lib";

export interface InitStartInput {}

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
	mode: "existing" | "new";
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
	instructions: string;
}

interface PendingSession {
	sessionId: string;
	apiUrl: string;
	repoCanonical?: string;
	repoAppDir?: string;
	mode: "existing" | "new";
	// Set when a valid stored auth token was found — skips browser polling entirely
	storedToken?: string;
	// Populated after vocoder_init_complete — used by vocoder_create_project
	resolvedToken?: string;
	// organizationId returned by the auth callback — workspace already known, skip lookup
	pollOrganizationId?: string;
}

// Survives for the lifetime of the MCP server process — one session at a time is fine
const pendingSessions = new Map<string, PendingSession>();

const POLL_INTERVAL_MS = 2000;
const AUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export async function runInitStart(
	_input: InitStartInput,
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
	const isReauth = storedAuth.status === "expired";
	const authUrl = session.verificationUrl;

	pendingSessions.set(session.sessionId, {
		sessionId: session.sessionId,
		apiUrl,
		repoCanonical: identity?.repoCanonical,
		repoAppDir: identity?.appDir,
		mode: "new",
	});

	const modeNote = isReauth
		? "This URL signs you back in to your existing workspace."
		: "This URL opens the Vocoder sign-in page. After authenticating, the CLI session will complete automatically.";

	return {
		authUrl,
		sessionId: session.sessionId,
		expiresAt: session.expiresAt,
		mode: "new",
		existingApps,
		instructions: `Ask the user to open this link to authenticate: [Authenticate with Vocoder](${authUrl})\n\n${modeNote}${existingNote}\n\nTell the user to reply when they've finished the browser flow. Wait for their confirmation — do nothing else until they confirm.`,
	};
}

// Polls for the auth token and writes auth.json. No workspace resolution — that
// happens in vocoder_create_project so re-runs don't hit "already claimed" errors.
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
				// organizationId returned by auth callback — skip workspace lookup if present.
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
		instructions: `Authenticated. Now ask the user for: sourceLocale (e.g. "en"), targetLocales (e.g. ["es", "fr"]), targetBranches (e.g. ["main"]), and optional projectName. Then call vocoder_create_project.`,
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

	// Resolve organization — happens here (not in init_complete) so re-runs are safe.
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
			repoCanonical: session.repoCanonical,
		});
	} catch (err) {
		pendingSessions.delete(input.sessionId);
		const msg = err instanceof VocoderAPIError ? err.message : String(err);
		throw new Error(`Project creation failed: ${msg}`);
	}

	pendingSessions.delete(input.sessionId);

	const repoWarning = !projectResult.repositoryBound && session.repoCanonical
		? `\n\nNote: Repository auto-bind did not complete — the repo will bind automatically on the first translate run.`
		: "";

	const branches = input.targetBranches.map((b) => `'${b}'`).join(", ");
	const workflowYaml = [
		`name: Vocoder Translate`,
		`on:`,
		`  push:`,
		`    branches: [${branches}]`,
		`jobs:`,
		`  translate:`,
		`    runs-on: ubuntu-latest`,
		`    steps:`,
		`      - uses: actions/checkout@v4`,
		`      - uses: vocoder-i18n/translate-action@v1`,
		`        with:`,
		`          api-key: \${{ secrets.VOCODER_API_KEY }}`,
		`          on-failure: proceed`,
	].join("\n");

	return {
		...projectResult,
		instructions: [
			`Project "${projectResult.projectName}" created. Next steps:`,
			``,
			`1. Write to .env at the project root:`,
			`   VOCODER_API_KEY=${projectResult.apiKey}`,
			``,
			`2. Write .github/workflows/vocoder.yml — create directories if needed:`,
			``,
			workflowYaml,
			``,
			`   If the file already exists, do NOT overwrite it — tell the user to review it.`,
			`   For monorepos, also write a vocoder.config.ts at the repo root with an apps[] array listing each app directory.`,
			``,
			`3. Tell the user to add VOCODER_API_KEY as a GitHub repository secret:`,
			`   GitHub repo → Settings → Secrets and variables → Actions → New repository secret`,
			`   Name:  VOCODER_API_KEY`,
			`   Value: ${projectResult.apiKey}`,
			``,
			`4. Tell the user to commit the workflow file:`,
			`   git add .github/workflows/vocoder.yml && git commit -m "Add Vocoder translate workflow"`,
			``,
			`5. Call vocoder_implement_i18n to install packages, set up VocoderProvider, and get the list of files to wrap strings in.`,
			``,
			`6. Tell the user: add VOCODER_API_KEY=${projectResult.apiKey} to their MCP server environment config and restart their editor.`,
			repoWarning,
		]
			.join("\n")
			.trim(),
	};
}

// Resolves the organization ID to use for project creation.
// Order: poll-callback organizationId → only org covering this repo → sole org →
// first org overall. Ambiguity (multiple non-covering orgs) is resolved by
// picking the first one because the MCP has no way to prompt a human.
async function resolveOrganization(
	api: VocoderAPI,
	userToken: string,
	session: PendingSession,
): Promise<string> {
	if (session.pollOrganizationId) {
		return session.pollOrganizationId;
	}

	const organizationData = await api.listOrganizations(userToken, {
		repo: session.repoCanonical,
	});

	const covering = session.repoCanonical
		? organizationData.organizations.filter((w) => w.coversRepo === true)
		: [];

	if (covering.length === 1) return covering[0]!.id;
	if (organizationData.organizations.length === 1)
		return organizationData.organizations[0]!.id;
	if (organizationData.organizations.length > 1) {
		return (covering[0] ?? organizationData.organizations[0])!.id;
	}

	// No workspace exists — auto-create a default one if the plan allows it.
	if (organizationData.canCreateOrganization) {
		const userInfo = await api.getCliUserInfo(userToken);
		const name = userInfo.name ? `${userInfo.name}'s Workspace` : "My Workspace";
		const created = await api.createOrganization(userToken, { name });
		return created.organizationId;
	}

	throw new Error(
		"You're not a member of any workspace. Visit [vocoder.app](https://vocoder.app) to create one, then re-run vocoder_init_start.",
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
