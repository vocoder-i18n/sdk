import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("verifyStoredAuth", () => {
	let tempHome = "";

	beforeEach(() => {
		tempHome = mkdtempSync(join(tmpdir(), "vocoder-auth-store-"));
		vi.resetModules();
		vi.doMock("node:os", () => ({
			homedir: () => tempHome,
		}));
	});

	afterEach(() => {
		vi.doUnmock("node:os");
		vi.restoreAllMocks();
		rmSync(tempHome, { recursive: true, force: true });
	});

	async function loadModule() {
		const authStore = await import("../utils/auth-store.js");
		const { VocoderAPIError } = await import("../utils/api.js");
		return { ...authStore, VocoderAPIError };
	}

	it("preserves stored auth on network errors", async () => {
		const { readAuthData, verifyStoredAuth, writeAuthData } = await loadModule();

		writeAuthData({
			token: "user-token",
			userId: "user-1",
			email: "user@example.com",
			name: "User",
			createdAt: new Date().toISOString(),
		});

		const result = await verifyStoredAuth({
			getCliUserInfo: vi.fn().mockRejectedValue(new Error("network down")),
		} as never);

		expect(result).toMatchObject({
			status: "unreachable",
			stored: expect.objectContaining({ email: "user@example.com" }),
		});
		expect(readAuthData()).toMatchObject({ email: "user@example.com" });
	});

	it("preserves stored auth on 500 responses", async () => {
		const { readAuthData, verifyStoredAuth, writeAuthData, VocoderAPIError } =
			await loadModule();

		writeAuthData({
			token: "user-token",
			userId: "user-1",
			email: "user@example.com",
			name: "User",
			createdAt: new Date().toISOString(),
		});

		const result = await verifyStoredAuth({
			getCliUserInfo: vi.fn().mockRejectedValue(
				new VocoderAPIError({
					message: "Server error",
					status: 500,
					payload: null,
				}),
			),
		} as never);

		expect(result).toMatchObject({
			status: "unreachable",
			stored: expect.objectContaining({ email: "user@example.com" }),
		});
		expect(readAuthData()).toMatchObject({ email: "user@example.com" });
	});

	it.each([401, 403])(
		"clears stored auth on %s responses",
		async (statusCode) => {
			const { readAuthData, verifyStoredAuth, writeAuthData, VocoderAPIError } =
				await loadModule();

			writeAuthData({
				token: "user-token",
				userId: "user-1",
				email: "user@example.com",
				name: "User",
				createdAt: new Date().toISOString(),
			});

			const result = await verifyStoredAuth({
				getCliUserInfo: vi.fn().mockRejectedValue(
					new VocoderAPIError({
						message: "Rejected",
						status: statusCode,
						payload: null,
					}),
				),
			} as never);

			expect(result.status).toBe("expired");
			expect(readAuthData()).toBeNull();
		},
	);

	it("clears stored auth on 404 responses", async () => {
		const { readAuthData, verifyStoredAuth, writeAuthData, VocoderAPIError } =
			await loadModule();

		writeAuthData({
			token: "user-token",
			userId: "user-1",
			email: "user@example.com",
			name: "User",
			createdAt: new Date().toISOString(),
		});

		const result = await verifyStoredAuth({
			getCliUserInfo: vi.fn().mockRejectedValue(
				new VocoderAPIError({
					message: "Missing",
					status: 404,
					payload: null,
				}),
			),
		} as never);

		expect(result.status).toBe("gone");
		expect(readAuthData()).toBeNull();
	});
});
