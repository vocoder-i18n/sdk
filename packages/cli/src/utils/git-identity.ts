import { execSync } from "node:child_process";
import { relative } from "node:path";

export type GitRepositoryIdentity = {
	repoCanonical: string;
	/** Absolute path to the git repository root (`git rev-parse --show-toplevel`). */
	repoRoot: string;
	/** App directory relative to repo root (empty string for root-level apps). */
	appDir: string;
};

export type GitContext = {
	identity: GitRepositoryIdentity | null;
	warnings: string[];
};

const SHA_REGEX = /^[0-9a-f]{40}$/i;

/**
 * Detect the current commit SHA from CI env vars or git.
 * Must produce the same result as detectCommitSha() in @vocoder/plugin
 * so fingerprints computed by CLI sync and unplugin build match.
 */
export function detectCommitSha(): string | null {
	if (
		process.env.VOCODER_COMMIT_SHA &&
		SHA_REGEX.test(process.env.VOCODER_COMMIT_SHA)
	) {
		return process.env.VOCODER_COMMIT_SHA;
	}

	const knownSha =
		process.env.GITHUB_SHA ||
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.CI_COMMIT_SHA ||
		process.env.BITBUCKET_COMMIT ||
		process.env.CIRCLE_SHA1 ||
		process.env.RENDER_GIT_COMMIT;

	if (knownSha && SHA_REGEX.test(knownSha)) return knownSha;

	return safeExec("git rev-parse HEAD");
}

function safeExec(command: string): string | null {
	try {
		const output = execSync(command, {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "ignore"],
		}).trim();
		return output.length > 0 ? output : null;
	} catch {
		return null;
	}
}

function normalizePath(pathname: string): string | null {
	const cleaned = pathname
		.replace(/^\/+/, "")
		.replace(/\.git$/i, "")
		.trim();

	if (!cleaned || !cleaned.includes("/")) {
		return null;
	}

	return cleaned;
}

function parseRemoteUrl(remoteUrl: string): {
	host: string;
	ownerRepoPath: string;
} | null {
	const trimmed = remoteUrl.trim();
	if (!trimmed) {
		return null;
	}

	// SCP-like syntax: git@github.com:owner/repo.git
	if (!trimmed.includes("://")) {
		const scpMatch = trimmed.match(/^(?:.+@)?([^:]+):(.+)$/);
		if (scpMatch) {
			const host = (scpMatch[1] || "").toLowerCase();
			const ownerRepoPath = normalizePath(scpMatch[2] || "");
			if (!host || !ownerRepoPath) {
				return null;
			}
			return { host, ownerRepoPath };
		}
		return null;
	}

	try {
		const parsed = new URL(trimmed);
		const host = parsed.hostname.toLowerCase();
		const ownerRepoPath = normalizePath(decodeURIComponent(parsed.pathname));
		if (!host || !ownerRepoPath) {
			return null;
		}
		return { host, ownerRepoPath };
	} catch {
		return null;
	}
}

function toCanonical(host: string, ownerRepoPath: string): string {
	if (host.includes("github.com")) {
		return `github:${ownerRepoPath.toLowerCase()}`;
	}
	if (host.includes("gitlab.com")) {
		return `gitlab:${ownerRepoPath.toLowerCase()}`;
	}
	if (host.includes("bitbucket.org")) {
		return `bitbucket:${ownerRepoPath.toLowerCase()}`;
	}
	return `git:${host}/${ownerRepoPath.toLowerCase()}`;
}

export function resolveGitRepositoryIdentity(): GitRepositoryIdentity | null {
	const remoteUrl = safeExec("git config --get remote.origin.url");
	if (!remoteUrl) {
		return null;
	}

	const parsed = parseRemoteUrl(remoteUrl);
	if (!parsed) {
		return null;
	}

	const repoRoot = safeExec("git rev-parse --show-toplevel");
	if (!repoRoot) {
		return null;
	}

	return {
		repoCanonical: toCanonical(parsed.host, parsed.ownerRepoPath),
		repoRoot,
		appDir: resolveCurrentAppDir(repoRoot),
	};
}

export function detectRepoIdentity(): GitRepositoryIdentity | null {
	return resolveGitRepositoryIdentity();
}

/**
 * Returns the absolute path to the git repository root, or null when not inside a repo.
 * Used to anchor YAML lookup, config loading, and extraction paths regardless of which
 * subdirectory the CLI was invoked from.
 */
export function resolveGitRoot(): string | null {
	return safeExec("git rev-parse --show-toplevel");
}

export function resolveCurrentAppDir(repoRoot: string, cwd = process.cwd()): string {
	const appDir = relative(repoRoot, cwd).replace(/\\/g, "/").replace(/^\.\/|\/$/g, "");
	return appDir === "." ? "" : appDir;
}

export function resolveGitContext(): GitContext {
	const warnings: string[] = [];
	const identity = resolveGitRepositoryIdentity();

	if (!identity) {
		warnings.push(
			"Could not detect git remote origin. Repo binding will be skipped until sync can detect it.",
		);
	}

	return { identity, warnings };
}
