import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockIntro,
	mockOutro,
	mockLog,
	mockEnsureAccountAuth,
	mockVerifyStoredAuth,
	mockReadAuthData,
	mockClearAuthData,
	mockRevokeCliToken,
} = vi.hoisted(() => ({
	mockIntro: vi.fn(),
	mockOutro: vi.fn(),
	mockLog: {
		success: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		message: vi.fn(),
	},
	mockEnsureAccountAuth: vi.fn(),
	mockVerifyStoredAuth: vi.fn(),
	mockReadAuthData: vi.fn(),
	mockClearAuthData: vi.fn(),
	mockRevokeCliToken: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
	intro: mockIntro,
	outro: mockOutro,
	log: mockLog,
	spinner: () => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	}),
}));

vi.mock("../utils/account-auth.js", () => ({
	ensureAccountAuth: mockEnsureAccountAuth,
}));

vi.mock("../utils/auth-store.js", () => ({
	verifyStoredAuth: mockVerifyStoredAuth,
	readAuthData: mockReadAuthData,
	clearAuthData: mockClearAuthData,
}));

vi.mock("../utils/api.js", () => ({
	VocoderAPI: class {
		revokeCliToken = mockRevokeCliToken;
	},
}));

import { authLogin } from "../commands/auth-login.js";
import { authLogout } from "../commands/auth-logout.js";
import { authStatus } from "../commands/auth-status.js";

beforeEach(() => {
	vi.clearAllMocks();
	process.env.NO_COLOR = "1";
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("authLogin", () => {
	it("shows the stored account when already signed in", async () => {
		mockEnsureAccountAuth.mockResolvedValue({
			status: "authenticated",
			source: "stored",
			auth: {
				token: "user-token",
				userId: "user-1",
				email: "user@example.com",
				name: "Test User",
				createdAt: new Date().toISOString(),
			},
		});

		const code = await authLogin();

		expect(code).toBe(0);
		expect(mockLog.success).toHaveBeenCalledWith("Signed in: Yes");
		expect(mockLog.success).toHaveBeenCalledWith("Account: user@example.com");
		expect(mockOutro).toHaveBeenCalled();
	});
});

describe("authStatus", () => {
	it("returns 0 when credentials are valid", async () => {
		mockVerifyStoredAuth.mockResolvedValue({
			status: "valid",
			token: "user-token",
			userId: "user-1",
			email: "user@example.com",
			name: "Test User",
			createdAt: new Date().toISOString(),
		});

		const code = await authStatus();

		expect(code).toBe(0);
		expect(mockLog.success).toHaveBeenCalledWith("Signed in: Yes");
		expect(mockLog.success).toHaveBeenCalledWith("Account: user@example.com");
	});

	it("returns 1 and warns when stored auth cannot be verified", async () => {
		mockVerifyStoredAuth.mockResolvedValue({
			status: "unreachable",
			stored: {
				token: "user-token",
				userId: "user-1",
				email: "user@example.com",
				name: null,
				createdAt: new Date().toISOString(),
			},
			message: "Server error",
		});

		const code = await authStatus();

		expect(code).toBe(1);
		expect(mockLog.success).toHaveBeenCalledWith("Signed in: Yes");
		expect(mockLog.warn).toHaveBeenCalledWith(
			"Could not verify the stored account with the server.",
		);
		expect(mockLog.message).toHaveBeenCalledWith("Server error");
	});
});

describe("authLogout", () => {
	it("returns 0 even when already signed out", async () => {
		mockReadAuthData.mockReturnValue(null);

		const code = await authLogout();

		expect(code).toBe(0);
		expect(mockLog.success).toHaveBeenCalledWith("Signed in: No");
	});

	it("clears local auth even if revoke fails", async () => {
		mockReadAuthData.mockReturnValue({
			token: "user-token",
			userId: "user-1",
			email: "user@example.com",
			name: null,
			createdAt: new Date().toISOString(),
		});
		mockRevokeCliToken.mockRejectedValue(new Error("network"));

		const code = await authLogout();

		expect(code).toBe(0);
		expect(mockClearAuthData).toHaveBeenCalled();
		expect(mockLog.success).toHaveBeenCalledWith("Logged out: user@example.com");
	});
});
