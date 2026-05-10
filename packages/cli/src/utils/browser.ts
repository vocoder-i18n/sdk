/**
 * @module browser
 *
 * Cross-platform utility for opening a URL in the user's default browser.
 * Used by auth-flow and plan-check flows that need to direct users to a URL.
 *
 * Exports: tryOpenBrowser
 */

import { spawn } from "node:child_process";

/**
 * Attempts to open a URL in the system browser. Returns false in CI or when
 * the launch fails — callers should fall back to displaying the URL as text.
 */
export async function tryOpenBrowser(url: string): Promise<boolean> {
	if (!process.stdout.isTTY || process.env.CI === "true") {
		return false;
	}

	let command: string;
	let args: string[];

	if (process.platform === "darwin") {
		command = "open";
		args = [url];
	} else if (process.platform === "win32") {
		command = "rundll32";
		args = ["url.dll,FileProtocolHandler", url];
	} else {
		command = "xdg-open";
		args = [url];
	}

	return new Promise<boolean>((resolve) => {
		try {
			const child = spawn(command, args, {
				detached: true,
				stdio: "ignore",
				windowsHide: true,
			});

			let settled = false;
			child.once("spawn", () => {
				if (settled) return;
				settled = true;
				child.unref();
				resolve(true);
			});
			child.once("error", () => {
				if (settled) return;
				settled = true;
				resolve(false);
			});
			setTimeout(() => {
				if (settled) return;
				settled = true;
				resolve(false);
			}, 300);
		} catch {
			resolve(false);
		}
	});
}
