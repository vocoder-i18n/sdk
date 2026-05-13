import { VocoderAPI } from "@vocoder/cli/lib";

export { VocoderAPI };

export const NO_API_KEY_MESSAGE =
	"VOCODER_API_KEY is not set. Run `npx @vocoder/cli init` to get an API key, then add it to your MCP server config as VOCODER_API_KEY.";

export function createClient(): VocoderAPI | null {
	const apiKey = process.env.VOCODER_API_KEY;
	if (!apiKey) return null;
	const apiUrl = process.env.VOCODER_API_URL ?? "https://vocoder.app";
	return new VocoderAPI({ apiKey, apiUrl });
}
