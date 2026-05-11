import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { StringExtractor, computeFingerprint, loadVocoderConfig } from "@vocoder/extractor";
import type { VocoderTranslationData } from "./types";

export { computeFingerprint } from "@vocoder/extractor";

/**
 * Load .env file into process.env if not already loaded.
 * Build plugins run before the bundler's own .env loading,
 * so we need to handle it ourselves.
 */
export function loadEnvFile(): void {
	const envPath = resolve(process.cwd(), ".env");
	if (!existsSync(envPath)) return;

	try {
		const content = readFileSync(envPath, "utf-8");
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const eqIndex = trimmed.indexOf("=");
			if (eqIndex === -1) continue;
			const key = trimmed.slice(0, eqIndex).trim();
			const value = trimmed
				.slice(eqIndex + 1)
				.trim()
				.replace(/^["']|["']$/g, "");
			if (!(key in process.env)) {
				process.env[key] = value;
			}
		}
	} catch {
		// Non-fatal
	}
}

export type RepoIdentity = {
	repoCanonical: string;
	appDir: string;
};


const DEFAULT_INCLUDE = ["**/*.{tsx,jsx,ts,js}"];

/**
 * Extract source text strings from the project.
 * Patterns come from vocoder.config.{ts,js,json} committed to the repository —
 * the single source of truth shared by the build plugin, CLI sync, and git webhook.
 * Falls back to the default glob if no config file exists.
 */
/**
 * Extract deduplicated source keys for fingerprinting.
 * Returns keys (not source texts) so that two strings with the same text but
 * different formality or context each count as distinct fingerprint inputs.
 */
export async function extractSourceKeys(cwd: string): Promise<string[]> {
	const config = loadVocoderConfig(cwd);
	const include = config?.include ?? DEFAULT_INCLUDE;
	const exclude = config?.exclude;

	const extractor = new StringExtractor();
	const results = await extractor.extractFromProject(include, cwd, exclude);

	return [...new Set(results.map((r) => r.key))];
}


const CDN_POLL_INTERVAL_MS = 3000;
const CDN_POLL_MAX_WAIT_MS = 30_000;

/**
 * Called when no translations exist for the current fingerprint at dev-server startup.
 * In the GitHub Action model, translations are submitted before the build runs —
 * this path means the translate workflow has not run yet for this fingerprint.
 */
export async function triggerOnDemandSync(params: {
	fingerprint: string;
	branch: string;
	apiUrl: string;
	apiKey: string;
	cdnUrl: string;
}): Promise<VocoderTranslationData | null> {
	console.log(`[vocoder] No translations found for fingerprint ${params.fingerprint} — run the Vocoder translate workflow to generate them`);
	return null;
}

const SHA_REGEX = /^[0-9a-f]{40}$/i;

/**
 * Detect the current commit SHA from CI env vars, fuzzy env scan, or .git files.
 * Returns null if detection fails — callers should fall back to branch-based fingerprint.
 *
 * Priority:
 * 1. VOCODER_COMMIT_SHA — explicit override
 * 2. Known platform env vars
 * 3. Fuzzy scan of all env vars for 40-char hex values
 * 4. Git file fallback (.git/refs/heads/<branch> or .git/packed-refs)
 */
export function detectCommitSha(): string | null {
	// 1. Explicit override
	if (
		process.env.VOCODER_COMMIT_SHA &&
		SHA_REGEX.test(process.env.VOCODER_COMMIT_SHA)
	) {
		return process.env.VOCODER_COMMIT_SHA;
	}

	// 2. Known platform env vars
	const knownSha =
		process.env.GITHUB_SHA ||
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.CI_COMMIT_SHA ||
		process.env.BITBUCKET_COMMIT ||
		process.env.CIRCLE_SHA1 ||
		process.env.RENDER_GIT_COMMIT;

	if (knownSha && SHA_REGEX.test(knownSha)) return knownSha;

	// 3. Fuzzy scan — look for any env var whose key suggests a SHA and value looks like one.
	// Sort entries deterministically (by key) so the result is stable across runs.
	const fuzzyMatch = Object.entries(process.env)
		.filter(
			([key, value]) =>
				/sha|commit/i.test(key) && value && SHA_REGEX.test(value),
		)
		.sort(([a], [b]) => a.localeCompare(b))[0];
	if (fuzzyMatch?.[1]) return fuzzyMatch[1];

	// 4. Git file fallback
	try {
		const gitDir = findGitDir(process.cwd());
		if (!gitDir) return null;

		const headPath = resolve(gitDir, "HEAD");
		const headContent = readFileSync(headPath, "utf-8").trim();

		// Detached HEAD — HEAD contains the SHA directly
		if (SHA_REGEX.test(headContent)) return headContent;

		// Symbolic ref — resolve to branch SHA
		const branchMatch = headContent.match(/^ref: refs\/heads\/(.+)$/);
		if (branchMatch?.[1]) {
			const branch = branchMatch[1];

			// Try loose ref file first
			const refPath = resolve(gitDir, "refs", "heads", branch);
			if (existsSync(refPath)) {
				const sha = readFileSync(refPath, "utf-8").trim();
				if (SHA_REGEX.test(sha)) return sha;
			}

			// Fall back to packed-refs
			const packedRefsPath = resolve(gitDir, "packed-refs");
			if (existsSync(packedRefsPath)) {
				const packedRefs = readFileSync(packedRefsPath, "utf-8");
				const target = `refs/heads/${branch}`;
				for (const line of packedRefs.split("\n")) {
					if (line.endsWith(target)) {
						const sha = line.split(" ")[0]?.trim();
						if (sha && SHA_REGEX.test(sha)) return sha;
					}
				}
			}
		}
	} catch {
		// Non-fatal
	}

	return null;
}

/**
 * Detect the current git branch from CI env vars or .git/HEAD.
 * No execSync — reads .git/HEAD directly for safety in build plugins.
 */
export function detectBranch(): string {
	const envBranch =
		process.env.GITHUB_HEAD_REF ||
		process.env.GITHUB_REF_NAME ||
		process.env.VERCEL_GIT_COMMIT_REF ||
		process.env.BRANCH ||
		process.env.CF_PAGES_BRANCH ||
		process.env.CI_COMMIT_REF_NAME ||
		process.env.BITBUCKET_BRANCH ||
		process.env.CIRCLE_BRANCH ||
		process.env.RENDER_GIT_BRANCH;

	if (envBranch) return envBranch;

	try {
		const gitDir = findGitDir(process.cwd());
		if (gitDir) {
			const headPath = resolve(gitDir, "HEAD");
			const content = readFileSync(headPath, "utf-8").trim();
			const match = content.match(/^ref: refs\/heads\/(.+)$/);
			if (match?.[1]) return match[1];
		}
	} catch {
		// Fall through to default
	}

	return "main";
}

/**
 * Walk up from startDir to find the .git directory.
 */
function findGitDir(startDir: string): string | null {
	let dir = startDir;
	for (let i = 0; i < 20; i++) {
		const gitDir = resolve(dir, ".git");
		if (existsSync(gitDir)) return gitDir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

/**
 * Detect the repository identity from CI environment variables or .git/config.
 * CI env vars are checked first so Docker builds and shallow clones work
 * without a .git directory. Falls back to .git/config for local development.
 */
export function detectRepoIdentity(): RepoIdentity | null {
	const fromEnv = detectRepoIdentityFromEnv();
	if (fromEnv) return fromEnv;
	return detectRepoIdentityFromGit();
}

function detectRepoIdentityFromEnv(): RepoIdentity | null {
	// GitHub Actions: GITHUB_REPOSITORY = "owner/repo"
	if (process.env.GITHUB_REPOSITORY) {
		const canonical = `github:${process.env.GITHUB_REPOSITORY.toLowerCase()}`;
		return { repoCanonical: canonical, appDir: "" };
	}

	// Vercel: VERCEL_GIT_REPO_OWNER + VERCEL_GIT_REPO_SLUG
	if (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG) {
		const provider = (
			process.env.VERCEL_GIT_PROVIDER ?? "github"
		).toLowerCase();
		const ownerRepo =
			`${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`.toLowerCase();
		const canonical =
			provider === "github"
				? `github:${ownerRepo}`
				: provider === "gitlab"
					? `gitlab:${ownerRepo}`
					: provider === "bitbucket"
						? `bitbucket:${ownerRepo}`
						: `git:${ownerRepo}`;
		return { repoCanonical: canonical, appDir: "" };
	}

	// GitLab CI: CI_PROJECT_PATH = "owner/repo", CI_SERVER_HOST for non-gitlab.com
	if (process.env.CI_PROJECT_PATH) {
		const host = process.env.CI_SERVER_HOST ?? "gitlab.com";
		const ownerRepo = process.env.CI_PROJECT_PATH.toLowerCase();
		const canonical = host.includes("gitlab.com")
			? `gitlab:${ownerRepo}`
			: `git:${host}/${ownerRepo}`;
		return { repoCanonical: canonical, appDir: "" };
	}

	// Bitbucket Pipelines: BITBUCKET_REPO_FULL_NAME = "owner/repo"
	if (process.env.BITBUCKET_REPO_FULL_NAME) {
		const canonical = `bitbucket:${process.env.BITBUCKET_REPO_FULL_NAME.toLowerCase()}`;
		return { repoCanonical: canonical, appDir: "" };
	}

	// CircleCI: CIRCLE_PROJECT_USERNAME + CIRCLE_PROJECT_REPONAME
	if (
		process.env.CIRCLE_PROJECT_USERNAME &&
		process.env.CIRCLE_PROJECT_REPONAME
	) {
		const ownerRepo =
			`${process.env.CIRCLE_PROJECT_USERNAME}/${process.env.CIRCLE_PROJECT_REPONAME}`.toLowerCase();
		const canonical = `github:${ownerRepo}`;
		return { repoCanonical: canonical, appDir: "" };
	}

	return null;
}

function detectRepoIdentityFromGit(): RepoIdentity | null {
	const cwd = process.cwd();
	const gitDir = findGitDir(cwd);
	if (!gitDir) return null;

	const configPath = resolve(gitDir, "config");
	if (!existsSync(configPath)) return null;

	try {
		const content = readFileSync(configPath, "utf-8");
		const remoteUrl = parseGitConfigRemoteUrl(content);
		if (!remoteUrl) return null;

		const parsed = parseRemoteUrl(remoteUrl);
		if (!parsed) return null;

		const repoCanonical = toCanonical(parsed.host, parsed.ownerRepoPath);

		// Compute scope path: relative path from git root to cwd
		const gitRoot = dirname(gitDir);
		const rel = relative(gitRoot, cwd).replace(/\\/g, "/").trim();
		const appDir = rel && rel !== "." && !rel.startsWith("..") ? rel : "";

		return { repoCanonical, appDir };
	} catch {
		return null;
	}
}

/**
 * Parse the origin remote URL from .git/config content.
 */
function parseGitConfigRemoteUrl(content: string): string | null {
	const lines = content.split("\n");
	let inOriginRemote = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed === '[remote "origin"]') {
			inOriginRemote = true;
			continue;
		}

		if (inOriginRemote) {
			if (trimmed.startsWith("[")) {
				break; // Entered a new section
			}
			const match = trimmed.match(/^url\s*=\s*(.+)$/);
			if (match?.[1]) return match[1].trim();
		}
	}

	return null;
}

/**
 * Parse a git remote URL into host + owner/repo path.
 * Supports both HTTPS and SCP-style SSH URLs.
 */
function parseRemoteUrl(
	remoteUrl: string,
): { host: string; ownerRepoPath: string } | null {
	const trimmed = remoteUrl.trim();
	if (!trimmed) return null;

	// SCP-like syntax: git@github.com:owner/repo.git
	if (!trimmed.includes("://")) {
		const scpMatch = trimmed.match(/^(?:.+@)?([^:]+):(.+)$/);
		if (scpMatch) {
			const host = (scpMatch[1] || "").toLowerCase();
			const ownerRepoPath = normalizePath(scpMatch[2] || "");
			if (!host || !ownerRepoPath) return null;
			return { host, ownerRepoPath };
		}
		return null;
	}

	try {
		const parsed = new URL(trimmed);
		const host = parsed.hostname.toLowerCase();
		const ownerRepoPath = normalizePath(decodeURIComponent(parsed.pathname));
		if (!host || !ownerRepoPath) return null;
		return { host, ownerRepoPath };
	} catch {
		return null;
	}
}

function normalizePath(pathname: string): string | null {
	const cleaned = pathname
		.replace(/^\/+/, "")
		.replace(/\.git$/i, "")
		.trim();

	if (!cleaned || !cleaned.includes("/")) return null;
	return cleaned;
}

function toCanonical(host: string, ownerRepoPath: string): string {
	if (host.includes("github.com"))
		return `github:${ownerRepoPath.toLowerCase()}`;
	if (host.includes("gitlab.com"))
		return `gitlab:${ownerRepoPath.toLowerCase()}`;
	if (host.includes("bitbucket.org"))
		return `bitbucket:${ownerRepoPath.toLowerCase()}`;
	return `git:${host}/${ownerRepoPath.toLowerCase()}`;
}

/**
 * Fetch all translations from the Vocoder API for a given fingerprint.
 * The server automatically waits for any in-flight translations to complete
 * before responding, avoiding build-time race conditions.
 * Falls back to disk cache if the API is unreachable.
 */
export async function fetchTranslations(
	fingerprint: string,
	apiUrl: string,
): Promise<VocoderTranslationData> {
	const url = `${apiUrl}/api/t/${fingerprint}`;
	const cacheDir = resolve(process.cwd(), "node_modules", ".vocoder", "cache");
	const cacheFile = resolve(cacheDir, `${fingerprint}.json`);

	try {
		const response = await fetch(url, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(45000),
		});

		if (!response.ok) {
			throw new Error(`API returned ${response.status}`);
		}

		const data = (await response.json()) as VocoderTranslationData;

		// Cache to disk for offline fallback
		try {
			mkdirSync(cacheDir, { recursive: true });
			writeFileSync(cacheFile, JSON.stringify(data), "utf-8");
		} catch {
			// Non-fatal: caching failed
		}

		return data;
	} catch (error) {
		// Try disk cache fallback
		if (existsSync(cacheFile)) {
			try {
				const cached = JSON.parse(
					readFileSync(cacheFile, "utf-8"),
				) as VocoderTranslationData;
				console.warn("[vocoder] API unreachable, using cached translations.");
				return cached;
			} catch {
				// Cache corrupted
			}
		}

		return {
			config: { sourceLocale: "", targetLocales: [], locales: {} },
			translations: {},
			updatedAt: null,
		};
	}
}

/**
 * Poll the CDN for a translation bundle until it appears or the timeout elapses.
 * The CDN is only populated after the translation batch fully completes, so a
 * successful response guarantees translations are complete — no partial results.
 *
 * Returns null if the bundle never appears within the timeout, so the caller
 * can fall back to the API endpoint which has its own server-side wait logic.
 */
export async function pollCDNForTranslations(
	fingerprint: string,
	cdnUrl: string,
): Promise<VocoderTranslationData | null> {
	const url = `${cdnUrl}/${fingerprint}/bundle.json`;
	const cacheDir = resolve(process.cwd(), "node_modules", ".vocoder", "cache");
	const cacheFile = resolve(cacheDir, `${fingerprint}.json`);
	const deadline = Date.now() + CDN_POLL_MAX_WAIT_MS;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(url, {
				headers: { Accept: "application/json" },
				signal: AbortSignal.timeout(10_000),
			});

			if (response.ok) {
				const data = (await response.json()) as VocoderTranslationData;
				try {
					mkdirSync(cacheDir, { recursive: true });
					writeFileSync(cacheFile, JSON.stringify(data), "utf-8");
				} catch {
					// Non-fatal
				}
				return data;
			}

			// Any non-404 failure (5xx, network) — bail immediately to API fallback
			if (response.status !== 404) return null;
		} catch {
			// Network/timeout error — bail to API fallback
			return null;
		}

		if (Date.now() + CDN_POLL_INTERVAL_MS < deadline) {
			await new Promise((r) => setTimeout(r, CDN_POLL_INTERVAL_MS));
		} else {
			break;
		}
	}

	return null;
}

/**
 * Fire-and-forget telemetry ping to Vocoder when the build could not bake
 * translations and fell back to runtime CDN fetching. Never throws — a telemetry
 * failure must never affect the build outcome.
 */
export async function reportBuildFallback(params: {
	apiUrl: string;
	apiKey: string;
	fingerprint: string;
	reason: string;
	stringsCount?: number;
}): Promise<void> {
	const { apiUrl, apiKey, fingerprint, reason, stringsCount } = params;

	const buildEnv =
		process.env.GITHUB_ACTIONS ? "github-actions" :
		process.env.VERCEL ? "vercel" :
		process.env.RENDER ? "render" :
		process.env.CI ? "ci" : "local";

	try {
		await fetch(`${apiUrl}/api/plugin/build-event`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
			},
			body: JSON.stringify({
				fingerprint,
				event: "build_fallback_to_runtime",
				reason,
				stringsCount,
				buildEnv,
			}),
			signal: AbortSignal.timeout(5_000),
		});
	} catch {
		// Never let telemetry affect the build
	}
}
