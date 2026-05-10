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
	mode?: "auto" | "required" | "best-effort";
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

	const response = await client.sync({
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
		requestedMode: input.mode ?? "auto",
		...(stringsHash ? { stringsHash } : {}),
		clientRunId: randomUUID(),
	});

	if (response.status === "UP_TO_DATE") {
		return `Up to date — ${response.totalStrings} string(s), no changes detected.`;
	}

	if (response.status === "COMPLETED") {
		return formatCompleted(
			response.newStrings,
			response.deletedStrings,
			response.totalStrings,
		);
	}

	// PENDING — poll if mode is not best-effort
	if (input.mode === "best-effort") {
		return `Sync queued. Batch ID: ${response.batchId}. ${response.newStrings} new string(s) submitted for translation.`;
	}

	return await pollSync(
		client,
		response.batchId,
		response.newStrings,
		response.totalStrings,
	);
}

async function pollSync(
	client: VocoderClient,
	batchId: string,
	newStrings: number,
	totalStrings: number,
): Promise<string> {
	const deadline = Date.now() + MAX_WAIT_MS;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const status = await client.getSyncStatus(batchId);

		if (status.status === "COMPLETED") {
			return formatCompleted(newStrings, undefined, totalStrings);
		}

		if (status.status === "FAILED") {
			return `Translation failed: ${status.errorMessage ?? "Unknown error"}. Batch ID: ${batchId}`;
		}
	}

	return `Translations are in progress (batch: ${batchId}). Check back shortly — ${newStrings} string(s) queued for ${totalStrings} total.`;
}

function formatCompleted(
	newStrings: number,
	deletedStrings: number | undefined,
	totalStrings: number,
): string {
	const parts = [`Sync complete.`, `${newStrings} new string(s) translated.`];
	if (deletedStrings) parts.push(`${deletedStrings} string(s) removed.`);
	parts.push(`${totalStrings} total string(s) in app.`);
	return parts.join(" ");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
