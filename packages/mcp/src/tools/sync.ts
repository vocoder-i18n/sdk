import { randomUUID } from "node:crypto";
import { StringExtractor } from "@vocoder/extractor";
import {
	detectBranch,
	detectCommitSha,
	detectRepoIdentity,
} from "@vocoder/plugin";
import type { VocoderClient } from "../client.js";

const DEFAULT_PATTERNS = [
	"src/**/*.{tsx,jsx,ts,js}",
	"app/**/*.{tsx,jsx,ts,js}",
	"pages/**/*.{tsx,jsx,ts,js}",
	"components/**/*.{tsx,jsx,ts,js}",
];

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 60000;

export interface SyncInput {
	branch?: string;
	force?: boolean;
}

export async function runSync(
	input: SyncInput,
	client: VocoderClient,
): Promise<string> {
	const config = await client.getConfig();

	if (config.targetLocales.length === 0) {
		return "No target locales configured. Add target locales to your app before syncing.";
	}

	const branch = input.branch ?? detectBranch();
	const commitSha = detectCommitSha() ?? undefined;
	const identity = detectRepoIdentity();

	const extractor = new StringExtractor();
	const strings = await extractor.extractFromProject(DEFAULT_PATTERNS);

	if (strings.length === 0) {
		return 'No translatable strings found. Wrap strings with <T>text</T> or t("text") and try again.';
	}

	// id-only entries (text: null) can't be translated without a localesPath source file — skip them.
	const submittable = strings.filter((s): s is typeof s & { text: string } => s.text != null);

	// Compute hash from keys for fast server-side dedup (omit when force=true so server re-translates).
	// Uses all strings (including id-only) so the hash captures the full set of translation units.
	let stringsHash: string | undefined;
	if (!input.force) {
		const crypto = await import("node:crypto");
		const sortedKeys = [...strings.map((s) => s.key)].sort();
		stringsHash = crypto
			.createHash("sha256")
			.update(JSON.stringify({ strings: sortedKeys, industry: null }))
			.digest("hex");
	}

	const response = await client.translate({
		branch,
		commitSha,
		stringEntries: submittable.map((s) => ({
			key: s.key,
			text: s.text,
			...(s.context ? { context: s.context } : {}),
			...(s.formality ? { formality: s.formality } : {}),
			...(s.uiRole ? { uiRole: s.uiRole } : {}),
		})),
		targetLocales: config.targetLocales,
		repoCanonical: identity?.repoCanonical,
		repoAppDir: identity?.appDir || undefined,
		...(stringsHash ? { stringsHash } : {}),
		clientRunId: randomUUID(),
	});

	// Server found a matching completed batch — no translation work needed.
	if (response.status === "complete") {
		return `Up to date — strings unchanged since last translation.`;
	}

	return await pollTranslate(client, response.jobId, submittable.length);
}

async function pollTranslate(
	client: VocoderClient,
	jobId: string,
	totalStrings: number,
): Promise<string> {
	const deadline = Date.now() + MAX_WAIT_MS;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const status = await client.getTranslateStatus(jobId);

		if (status.status === "complete") {
			return `Translation complete. ${totalStrings} string(s) submitted.`;
		}

		if (status.status === "failed") {
			return `Translation failed: ${status.error ?? "Unknown error"}. Job ID: ${jobId}`;
		}
	}

	return `Translations in progress (job: ${jobId}). ${totalStrings} string(s) queued. Check back shortly.`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
