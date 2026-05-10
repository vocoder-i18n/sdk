import { beforeEach, describe, expect, it, vi } from "vitest";
import * as p from "@clack/prompts";
import { runAuthFlow } from "../utils/auth-flow.js";

vi.mock("@clack/prompts", () => ({
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	confirm: vi.fn(),
	select: vi.fn(),
	note: vi.fn(),
	spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
	cancel: vi.fn(),
	isCancel: vi.fn((v) => v === Symbol.for("clack-cancel")),
}));

vi.mock("../utils/browser.js", () => ({
	tryOpenBrowser: vi.fn().mockResolvedValue(false),
}));

vi.mock("../utils/local-server.js", () => ({
	startCallbackServer: vi.fn().mockRejectedValue(new Error("port conflict")),
}));

const CANCEL = Symbol.for("clack-cancel");

function makeApi(overrides: Partial<{
	startCliAuthSession: any;
	pollCliAuthSession: any;
	startCliGitHubLinkSession: any;
	getCliUserInfo: any;
}> = {}) {
	return {
		startCliAuthSession: vi.fn().mockResolvedValue({
			sessionId: "sess-1",
			verificationUrl: "https://vocoder.app/auth/cli",
			installUrl: "https://github.com/apps/vocoder/installations/new",
			expiresAt: new Date(Date.now() + 60_000).toISOString(),
		}),
		pollCliAuthSession: vi.fn().mockResolvedValue({ status: "pending" }),
		startCliGitHubLinkSession: vi.fn().mockResolvedValue({ oauthUrl: "https://github.com/oauth" }),
		getCliUserInfo: vi.fn().mockResolvedValue({
			userId: "user-1",
			email: "user@example.com",
			name: "Test User",
		}),
		...overrides,
	} as any;
}

beforeEach(() => {
	vi.clearAllMocks();
	// Default TTY: non-interactive
	Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
	Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
});

// ── cancel ────────────────────────────────────────────────────────────────────

describe("runAuthFlow", () => {
	it("returns null when user cancels the reauth browser confirm", async () => {
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

		const api = makeApi();
		vi.mocked(p.confirm).mockResolvedValue(CANCEL as any);

		const result = await runAuthFlow(api, { yes: false }, /* reauth */ true);
		expect(result).toBeNull();
		expect(p.cancel).toHaveBeenCalled();
	});

	it("returns null when user declines reauth browser open", async () => {
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

		const api = makeApi();
		vi.mocked(p.confirm).mockResolvedValue(false);

		const result = await runAuthFlow(api, { yes: false }, /* reauth */ true);
		expect(result).toBeNull();
	});

	it("uses verificationUrl when reauth=true", async () => {
		const api = makeApi({
			startCliAuthSession: vi.fn().mockResolvedValue({
				sessionId: "sess-1",
				verificationUrl: "https://vocoder.app/auth/cli",
				installUrl: "https://github.com/apps/install",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
			pollCliAuthSession: vi.fn().mockResolvedValue({
				status: "complete",
				token: "test-token",
			}),
		});

		await runAuthFlow(api, { ci: true }, /* reauth */ true);
		expect(p.log.info).toHaveBeenCalledWith(
			expect.stringContaining("auth/cli"),
		);
	});

	it("uses installUrl when reauth=false (first-time setup)", async () => {
		const api = makeApi({
			startCliAuthSession: vi.fn().mockResolvedValue({
				sessionId: "sess-1",
				verificationUrl: "https://vocoder.app/auth/cli",
				installUrl: "https://github.com/apps/install",
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}),
			pollCliAuthSession: vi.fn().mockResolvedValue({
				status: "complete",
				token: "test-token",
			}),
		});

		await runAuthFlow(api, { ci: true }, /* reauth */ false);
		expect(p.log.info).toHaveBeenCalledWith(
			expect.stringContaining("apps/install"),
		);
	});

	it("returns null and logs error when session expires without token", async () => {
		const api = makeApi({
			startCliAuthSession: vi.fn().mockResolvedValue({
				sessionId: "sess-1",
				verificationUrl: "https://vocoder.app/auth/cli",
				installUrl: null,
				// already expired
				expiresAt: new Date(Date.now() - 1000).toISOString(),
			}),
			pollCliAuthSession: vi.fn().mockResolvedValue({ status: "pending" }),
		});

		const result = await runAuthFlow(api, { ci: true }, false);
		expect(result).toBeNull();
		expect(p.log.error).toHaveBeenCalledWith(
			expect.stringContaining("expired"),
		);
	});
});
