import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cliRoot = join(process.cwd());
const readme = readFileSync(join(cliRoot, "README.md"), "utf-8");
const binSource = readFileSync(join(cliRoot, "src/bin.ts"), "utf-8");

describe("README and CLI auth surface stay aligned", () => {
	it("documents the auth namespace and removes legacy account commands", () => {
		expect(readme).toContain("### `vocoder auth login`");
		expect(readme).toContain("### `vocoder auth status`");
		expect(readme).toContain("### `vocoder auth logout`");
		expect(readme).not.toContain("### `vocoder whoami`");
		expect(readme).not.toContain("### `vocoder logout`");
		expect(readme).not.toContain("VOCODER_AUTH_TOKEN");
	});

	it("defines the auth namespace in the CLI entrypoint", () => {
		expect(binSource).toContain('.command("auth")');
		expect(binSource).toContain('.command("login")');
		expect(binSource).toContain('.command("status")');
		expect(binSource).toContain('.command("logout")');
		expect(binSource).not.toContain('import { whoami }');
	});
});
