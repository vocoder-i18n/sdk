import { randomUUID } from "node:crypto";
import {
	type VocoderAPI,
	StringExtractor,
	buildStringEntries,
	computeSourceEntriesHash,
	extractProjectShortIdFromApiKey,
	loadVocoderConfig,
} from "@vocoder/cli/lib";
import { computeFingerprint } from "@vocoder/extractor";
import { detectBranch, detectCommitSha, detectRepoIdentity } from "@vocoder/plugin";

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 60000;

export interface TranslateInput {
	branch?: string;
	force?: boolean;
}

export async function runTranslate(input: TranslateInput, api: VocoderAPI): Promise<string> {
	const apiKey = process.env.VOCODER_API_KEY ?? "";
	const projectShortId = extractProjectShortIdFromApiKey(apiKey);
	if (!projectShortId) {
		return "Invalid API key format. Expected a project key (vcp_...).";
	}

	const config = await api.getAppConfig();

	if (config.targetLocales.length === 0) {
		return "No target locales configured. Add target locales to your project before translating.";
	}

	const branch = input.branch ?? detectBranch();
	const commitSha = detectCommitSha() ?? undefined;
	const identity = detectRepoIdentity();

	const projectRoot = process.cwd();
	const fileConfig = loadVocoderConfig(projectRoot);
	const includePattern: string | string[] =
		fileConfig?.include?.length ? fileConfig.include : ["**/*.{tsx,jsx,ts,js}"];
	const excludePattern = fileConfig?.exclude?.length ? fileConfig.exclude : undefined;
	const industry = fileConfig?.industry ?? fileConfig?.appIndustry;

	const extractor = new StringExtractor();
	const extractedStrings = await extractor.extractFromProject(
		includePattern,
		projectRoot,
		excludePattern,
	);

	if (extractedStrings.length === 0) {
		return 'No translatable strings found. Wrap strings with <T>text</T> or t("text") and try again.';
	}

	const stringEntries = buildStringEntries(extractedStrings);
	const submittable = stringEntries.filter(
		(e): e is typeof e & { text: string } => e.text != null,
	);

	if (submittable.length === 0) {
		return "No submittable strings found (all strings are id-only and require a localesPath source file).";
	}

	const sourceEntriesHash = input.force
		? undefined
		: computeSourceEntriesHash({ entries: stringEntries, industry: industry ?? null });

	const fingerprint = computeFingerprint(`${projectShortId}:`, stringEntries.map((e) => e.key));

	const response = await api.submitTranslate({
		apps: [
			{
				appDir: "",
				strings: submittable.map((s) => ({
					key: s.key,
					text: s.text,
					...(s.context ? { context: s.context } : {}),
					...(s.formality ? { formality: s.formality } : {}),
					...(s.uiRole ? { uiRole: s.uiRole } : {}),
				})),
				...(sourceEntriesHash ? { sourceEntriesHash } : {}),
			},
		],
		branch,
		...(commitSha ? { commitSha } : {}),
		repoUrl: identity?.repoCanonical ?? "",
		clientRunId: randomUUID(),
	});

	if (response.status === "complete") {
		return `Up to date — strings unchanged since last translation. Fingerprint: ${fingerprint}`;
	}

	return await pollTranslate(api, response.jobId, submittable.length);
}

async function pollTranslate(
	api: VocoderAPI,
	jobId: string,
	totalSourceEntries: number,
): Promise<string> {
	const deadline = Date.now() + MAX_WAIT_MS;

	while (Date.now() < deadline) {
		await sleep(POLL_INTERVAL_MS);
		const status = await api.pollTranslateStatus(jobId);

		if (status.status === "complete") {
			const appStatus = status.apps[0];
			const providers = appStatus ? Object.keys(appStatus.providers).join(", ") : "";
			return `Translation complete. ${totalSourceEntries} string(s) submitted${providers ? ` via ${providers}` : ""}.`;
		}

		if (status.status === "failed") {
			const errMsg = status.apps[0]?.error ?? "Unknown error";
			return `Translation failed: ${errMsg}. Job ID: ${jobId}`;
		}
	}

	return `Translations in progress (job: ${jobId}). ${totalSourceEntries} string(s) queued. Check back shortly.`;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
