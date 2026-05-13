/**
 * Extract project.shortId from a project API key.
 * Key format: vcp_{shortId}_{random}, where shortId is 8 base62 chars.
 * Returns null if key is malformed or not a project key.
 */
export function extractProjectShortIdFromApiKey(apiKey: string): string | null {
	const match = apiKey.match(/^vcp_([A-Za-z0-9]{8})_[A-Za-z0-9_-]+$/);
	return match?.[1] ?? null;
}
