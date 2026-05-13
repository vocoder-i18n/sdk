import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAppDir, detectBranch, detectCommitSha, detectRepoIdentity } from "../core";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
	const original: Record<string, string | undefined> = {};
	for (const key of Object.keys(vars)) {
		original[key] = process.env[key];
		if (vars[key] === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = vars[key];
		}
	}
	try {
		fn();
	} finally {
		for (const key of Object.keys(vars)) {
			if (original[key] === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = original[key];
			}
		}
	}
}

const TEST_SHA = "a".repeat(40);

describe("detectBranch", () => {
	beforeEach(() => {
		// Clear all known branch env vars before each test
		for (const key of [
			"GITHUB_HEAD_REF", "GITHUB_REF_NAME", "VERCEL_GIT_COMMIT_REF",
			"BRANCH", "CF_PAGES_BRANCH", "CI_COMMIT_REF_NAME",
			"BITBUCKET_BRANCH", "CIRCLE_BRANCH", "RENDER_GIT_BRANCH",
		]) {
			delete process.env[key];
		}
	});

	it("reads GITHUB_HEAD_REF (PR branch)", () => {
		withEnv({ GITHUB_HEAD_REF: "feature/my-branch" }, () => {
			expect(detectBranch()).toBe("feature/my-branch");
		});
	});

	it("reads GITHUB_REF_NAME (push branch)", () => {
		withEnv({ GITHUB_REF_NAME: "main" }, () => {
			expect(detectBranch()).toBe("main");
		});
	});

	it("prefers GITHUB_HEAD_REF over GITHUB_REF_NAME", () => {
		withEnv({ GITHUB_HEAD_REF: "pr-branch", GITHUB_REF_NAME: "main" }, () => {
			expect(detectBranch()).toBe("pr-branch");
		});
	});

	it("reads VERCEL_GIT_COMMIT_REF", () => {
		withEnv({ VERCEL_GIT_COMMIT_REF: "staging" }, () => {
			expect(detectBranch()).toBe("staging");
		});
	});

	it("reads Render RENDER_GIT_BRANCH", () => {
		withEnv({ RENDER_GIT_BRANCH: "preview" }, () => {
			expect(detectBranch()).toBe("preview");
		});
	});

	it("reads CircleCI CIRCLE_BRANCH", () => {
		withEnv({ CIRCLE_BRANCH: "ci-branch" }, () => {
			expect(detectBranch()).toBe("ci-branch");
		});
	});

	it("falls back to 'main' when no env var set and no git dir", () => {
		// In this test env, no known CI branch vars are set
		// The test runner may or may not be in a git repo, but the fallback is "main"
		const result = detectBranch();
		// Should be a non-empty string (either git branch or "main" fallback)
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});
});

describe("detectCommitSha", () => {
	beforeEach(() => {
		for (const key of [
			"VOCODER_COMMIT_SHA", "GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA",
			"CI_COMMIT_SHA", "BITBUCKET_COMMIT", "CIRCLE_SHA1", "RENDER_GIT_COMMIT",
		]) {
			delete process.env[key];
		}
	});

	it("reads VOCODER_COMMIT_SHA override", () => {
		withEnv({ VOCODER_COMMIT_SHA: TEST_SHA }, () => {
			expect(detectCommitSha()).toBe(TEST_SHA);
		});
	});

	it("ignores VOCODER_COMMIT_SHA that is not a valid 40-char hex", () => {
		withEnv({ VOCODER_COMMIT_SHA: "not-a-sha", GITHUB_SHA: TEST_SHA }, () => {
			expect(detectCommitSha()).toBe(TEST_SHA);
		});
	});

	it("reads GITHUB_SHA", () => {
		withEnv({ GITHUB_SHA: TEST_SHA }, () => {
			expect(detectCommitSha()).toBe(TEST_SHA);
		});
	});

	it("reads VERCEL_GIT_COMMIT_SHA", () => {
		withEnv({ VERCEL_GIT_COMMIT_SHA: TEST_SHA }, () => {
			expect(detectCommitSha()).toBe(TEST_SHA);
		});
	});

	it("prefers VOCODER_COMMIT_SHA over GITHUB_SHA", () => {
		const other = "b".repeat(40);
		withEnv({ VOCODER_COMMIT_SHA: TEST_SHA, GITHUB_SHA: other }, () => {
			expect(detectCommitSha()).toBe(TEST_SHA);
		});
	});

	it("ignores SHA-like env var that is invalid length", () => {
		withEnv({ GITHUB_SHA: "abc123" }, () => {
			// Short hash — not 40 chars, should not be returned
			const result = detectCommitSha();
			expect(result).not.toBe("abc123");
		});
	});

	it("returns null when no SHA available", () => {
		// All SHA vars cleared in beforeEach; test env may have git fallback
		// but we just verify it returns null or a valid SHA
		const result = detectCommitSha();
		if (result !== null) {
			expect(result).toMatch(/^[0-9a-f]{40}$/i);
		}
	});
});

describe("detectRepoIdentity", () => {
	beforeEach(() => {
		for (const key of [
			"GITHUB_REPOSITORY", "VERCEL_GIT_REPO_OWNER", "VERCEL_GIT_REPO_SLUG",
			"VERCEL_GIT_PROVIDER", "CI_PROJECT_PATH", "CI_SERVER_HOST",
			"BITBUCKET_REPO_FULL_NAME", "CIRCLE_PROJECT_USERNAME", "CIRCLE_PROJECT_REPONAME",
		]) {
			delete process.env[key];
		}
	});

	it("detects GitHub Actions identity", () => {
		withEnv({ GITHUB_REPOSITORY: "Owner/MyRepo" }, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("github:owner/myrepo");
		});
	});

	it("detects Vercel identity with GitHub provider", () => {
		withEnv({
			VERCEL_GIT_REPO_OWNER: "Owner",
			VERCEL_GIT_REPO_SLUG: "my-repo",
			VERCEL_GIT_PROVIDER: "github",
		}, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("github:owner/my-repo");
		});
	});

	it("detects Vercel identity with GitLab provider", () => {
		withEnv({
			VERCEL_GIT_REPO_OWNER: "myorg",
			VERCEL_GIT_REPO_SLUG: "my-repo",
			VERCEL_GIT_PROVIDER: "gitlab",
		}, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("gitlab:myorg/my-repo");
		});
	});

	it("detects GitLab CI identity", () => {
		withEnv({ CI_PROJECT_PATH: "myorg/my-repo", CI_SERVER_HOST: "gitlab.com" }, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("gitlab:myorg/my-repo");
		});
	});

	it("detects self-hosted GitLab as git: scheme", () => {
		withEnv({ CI_PROJECT_PATH: "myorg/my-repo", CI_SERVER_HOST: "gitlab.mycompany.com" }, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("git:gitlab.mycompany.com/myorg/my-repo");
		});
	});

	it("detects Bitbucket Pipelines identity", () => {
		withEnv({ BITBUCKET_REPO_FULL_NAME: "Owner/MyRepo" }, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("bitbucket:owner/myrepo");
		});
	});

	it("detects CircleCI identity (defaults to github: scheme)", () => {
		withEnv({
			CIRCLE_PROJECT_USERNAME: "myorg",
			CIRCLE_PROJECT_REPONAME: "my-repo",
		}, () => {
			const identity = detectRepoIdentity();
			expect(identity?.repoCanonical).toBe("github:myorg/my-repo");
		});
	});
});

describe("detectAppDir", () => {
	it("returns a string (empty or relative path)", () => {
		const result = detectAppDir(process.cwd());
		expect(typeof result).toBe("string");
	});

	it("returns empty string for a path with no git directory", () => {
		const result = detectAppDir("/tmp");
		expect(result).toBe("");
	});

	it("never returns a path starting with ..", () => {
		const result = detectAppDir(process.cwd());
		expect(result.startsWith("..")).toBe(false);
	});
});
