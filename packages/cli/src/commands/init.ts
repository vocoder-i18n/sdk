import * as p from "@clack/prompts";

import { VocoderAPI, VocoderAPIError } from "../utils/api.js";
import {
  buildInstallCommand,
  detectLocalEcosystem,
  getPackagesToInstall,
} from "../utils/detect-local.js";
import {
  clearAuthData,
  readAuthData,
  verifyStoredAuth,
  writeAuthData,
} from "../utils/auth-store.js";
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  findExistingConfig,
  writeVocoderConfig,
} from "../utils/write-config.js";
import { highlight, info } from "../utils/theme.js";
import { join, resolve } from "node:path";
import { runAppCreate, runProjectCreate } from "../utils/project-create.js";
import {
  runGitHubDiscoveryFlow,
  runGitHubInstallFlow,
  selectGitHubInstallation,
} from "../utils/github-connect.js";

import type { InitOptions } from "../types.js";
import chalk from "chalk";

import { config as loadEnv } from "dotenv";
import { resolveGitContext } from "../utils/git-identity.js";
import { selectOrganization } from "../utils/organization.js";
import { startCallbackServer } from "../utils/local-server.js";

loadEnv();

const SUBSCRIPTION_SETTINGS_PATH =
  "/dashboard/workspace/settings?tab=subscription";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryOpenBrowser(url: string): Promise<boolean> {
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

  return await new Promise<boolean>((resolve) => {
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

function isPlanLimitFailure(message?: string): boolean {
  if (!message) return false;
  return /limit|upgrade/i.test(message);
}

function getSubscriptionSettingsUrl(apiUrl: string): string {
  return new URL(SUBSCRIPTION_SETTINGS_PATH, apiUrl).toString();
}

function printPlanLimitMessage(apiUrl: string, message: string): void {
  p.log.error(`You are over your plan limits.\n   ${message}`);
  p.log.info(`Manage subscription: ${getSubscriptionSettingsUrl(apiUrl)}`);
}

interface ScaffoldParams {
  targetBranches: string[];
}

function runScaffold(params: ScaffoldParams): void {
  const { targetBranches } = params;

  const detection = detectLocalEcosystem();
  const useTypeScript = detection.isTypeScript;

  if (detection.ecosystem) {
    const frameworkLabel = detection.framework ?? detection.ecosystem;
    const pmLabel = detection.packageManager;
    p.log.info(`Detected:  ${chalk.bold(frameworkLabel)} (${pmLabel})`);
  }

  const { devPackages, runtimePackages } = getPackagesToInstall(detection);
  const allPackages = [...devPackages, ...runtimePackages];
  if (allPackages.length > 0) {
    p.log.info("");
    const installSpinner = p.spinner();
    installSpinner.start(`Installing ${allPackages.join(", ")}...`);

    try {
      if (devPackages.length > 0) {
        execSync(
          buildInstallCommand(detection.packageManager, devPackages, true),
          { stdio: "pipe", cwd: process.cwd() },
        );
      }
      if (runtimePackages.length > 0) {
        execSync(
          buildInstallCommand(detection.packageManager, runtimePackages, false),
          { stdio: "pipe", cwd: process.cwd() },
        );
      }
      installSpinner.stop(`Installed ${allPackages.join(", ")}`);
    } catch {
      installSpinner.stop("Package installation failed");
      const cmds = [
        devPackages.length > 0
          ? buildInstallCommand(detection.packageManager, devPackages, true)
          : null,
        runtimePackages.length > 0
          ? buildInstallCommand(
              detection.packageManager,
              runtimePackages,
              false,
            )
          : null,
      ]
        .filter(Boolean)
        .join(" && ");
      p.log.warn(`Run manually: ${highlight(cmds)}`);
    }
  } else if (detection.ecosystem) {
    p.log.info(`Packages:  ${chalk.green("already installed")}`);
  }

  const branchList =
    targetBranches.length > 0
      ? targetBranches.map((b) => highlight(b)).join(" or ")
      : highlight("your target branch");
  p.log.message("");
  p.log.success(`Push to ${branchList} to trigger your first translation run.`);
  p.log.message(info("  Docs: https://vocoder.app/docs/getting-started"));
}

function writeApiKeyToEnv(apiKey: string, repoRoot?: string): boolean {
  const envPath = join(repoRoot ?? process.cwd(), ".env");
  if (!existsSync(envPath)) return false;

  try {
    const content = readFileSync(envPath, "utf-8");
    const keyLine = `VOCODER_API_KEY=${apiKey}`;
    let updated: string;

    if (/^VOCODER_API_KEY=/m.test(content)) {
      updated = content.replace(/^VOCODER_API_KEY=.*/m, keyLine);
    } else {
      const sep = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
      updated = `${content}${sep}${keyLine}\n`;
    }

    writeFileSync(envPath, updated);
    return true;
  } catch {
    return false;
  }
}

function printApiKey(apiKey: string, repoRoot?: string): void {
  const saved = writeApiKeyToEnv(apiKey, repoRoot);

  p.log.message("");
  p.log.message(chalk.bold("Your API Key"));
  printCodeBlock(`VOCODER_API_KEY=${apiKey}`);
  if (saved) {
    p.log.success(chalk.dim("Saved to .env"));
  } else {
    p.log.message(chalk.dim("  Add the above to your .env file"));
  }
}

/**
 * Write one vocoder.config.ts per app directory and log the result.
 * Non-monorepo projects write a single config at the project root.
 */
function writeAppConfigs(
  apps: Array<{ appDir: string; appId: string }>,
  targetBranches: string[],
  useTypeScript: boolean,
  repoRoot?: string,
): void {
  const base = repoRoot ?? process.cwd();
  for (const app of apps) {
    const dir = app.appDir ? resolve(base, app.appDir) : base;
    const written = writeVocoderConfig({
      targetBranches,
      appId: app.appId,
      cwd: dir,
      useTypeScript,
    });
    if (written) {
      const displayPath = app.appDir ? `${app.appDir}/${written}` : written;
      p.log.success(`Created ${highlight(displayPath)}`);
    } else if (!findExistingConfig(dir)) {
      const ext = useTypeScript ? "ts" : "js";
      p.log.warn(
        `Could not write ${app.appDir ? `${app.appDir}/` : ""}vocoder.config.${ext} — create it manually.`,
      );
    }
  }
}

const MCP_DOCS_URL = "https://vocoder.app/docs/mcp";

function mcpServerJson(apiKey: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        vocoder: {
          type: "stdio",
          command: "npx",
          args: ["-y", "@vocoder/mcp"],
          env: { VOCODER_API_KEY: apiKey },
        },
      },
    },
    null,
    2,
  );
}

async function runMcpSetup(apiKey: string): Promise<void> {
  type Tool = "claude" | "cursor" | "windsurf" | "vscode" | "other";

  const tool = await p.select<Tool>({
    message: "Which AI editor?",
    options: [
      { value: "claude", label: "Claude Code" },
      { value: "cursor", label: "Cursor" },
      { value: "windsurf", label: "Windsurf" },
      { value: "vscode", label: "VS Code (GitHub Copilot)" },
      { value: "other", label: "Other — show the config JSON" },
    ],
  });

  if (p.isCancel(tool)) return;

  if (tool === "claude") {
    try {
      execSync(
        `claude mcp add --scope user --transport stdio --env VOCODER_API_KEY=${apiKey} vocoder -- npx -y @vocoder/mcp`,
        { stdio: "pipe" },
      );
      p.log.success("Vocoder MCP server registered in Claude Code.");
    } catch {
      p.log.message("Run this to register the MCP server:");
      printCommand(
        `claude mcp add --scope user --transport stdio --env VOCODER_API_KEY=${apiKey} vocoder -- npx -y @vocoder/mcp`,
      );
      p.log.message(info(`  Docs: ${MCP_DOCS_URL}`));
    }
    return;
  }

  const configPaths: Record<Exclude<Tool, "claude">, { path: string; merge: boolean }> = {
    cursor: { path: "~/.cursor/mcp.json", merge: true },
    windsurf: { path: "~/.codeium/windsurf/mcp_config.json", merge: true },
    vscode: { path: ".vscode/mcp.json", merge: true },
    other: { path: ".mcp.json", merge: false },
  };

  const { path: configPath, merge } = configPaths[tool];
  const mergeNote = merge
    ? chalk.dim(`  Merge into ${highlight(configPath)} (create if missing):`)
    : chalk.dim(`  Add to ${highlight(configPath)}:`);

  p.log.message(mergeNote);
  printCodeBlock(mcpServerJson(apiKey));
  p.log.message(info(`  Docs: ${MCP_DOCS_URL}`));
}

function tryClipboard(text: string): boolean {
  const tools: Array<{ cmd: string; args?: string[] }> = [
    { cmd: "pbcopy" },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "xsel", args: ["--clipboard", "--input"] },
    { cmd: "wl-copy" },
    { cmd: "clip" },
  ];
  for (const { cmd, args = [] } of tools) {
    try {
      execSync([cmd, ...args].join(" "), {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
      });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function printCommand(cmd: string): void {
  const copied = tryClipboard(cmd);
  process.stdout.write("\n");
  process.stdout.write(`  ${chalk.dim("$")} ${chalk.cyan(cmd)}\n`);
  if (copied) process.stdout.write(`  ${chalk.dim("↑ copied to clipboard")}\n`);
  process.stdout.write("\n");
}

function printCodeBlock(code: string): void {
  process.stdout.write("\n");
  for (const line of code.split("\n")) {
    process.stdout.write(`  ${line}\n`);
  }
  process.stdout.write("\n");
}

// ── Auth helpers ─────────────────────────────────────────────────────────────

/**
 * Run the browser authentication flow.
 * Returns `{ token, userInfo, organizationId? }` on success, or null if cancelled.
 * When `organizationId` is set, the GitHub App was installed in the same browser
 * trip — the caller should skip workspace selection and GitHub connect.
 *
 * @param reauth - When true, the user has an expired token and already has a workspace.
 *   Use verificationUrl (auth/cli page) instead of installUrl so we don't create a
 *   duplicate workspace. The direct-to-GitHub install URL is only for first-time setup.
 */
async function runAuthFlow(
  api: VocoderAPI,
  options: InitOptions,
  reauth = false,
  repoCanonical?: string,
): Promise<{
  token: string;
  userId: string;
  email: string;
  name: string | null;
  organizationId?: string;
  discoveryReady?: boolean;
} | null> {
  // Try to start a local callback server for instant token delivery.
  // In --ci mode the browser step is handled externally, so skip the callback
  // server and go straight to polling — simpler and testable.
  let server: Awaited<ReturnType<typeof startCallbackServer>> | null = null;
  if (!options.ci) {
    try {
      server = await startCallbackServer();
    } catch {
      // Port conflict or other issue — fall back to polling
    }
  }

  const session = await api.startCliAuthSession(server?.port, repoCanonical);
  // Re-auth: user already has a workspace — use verificationUrl (auth/cli page)
  // so we don't trigger a new GitHub App install and create a duplicate workspace.
  // First-time: use installUrl to combine Vocoder auth + App install in one trip.
  const browserUrl = reauth
    ? session.verificationUrl
    : (session.installUrl ?? session.verificationUrl);
  const expiresAt = new Date(session.expiresAt).getTime();
  p.log.info(browserUrl)

  if (options.ci) {
    // Machine-readable output for automated test harnesses.
    // Parsed by e2e/helpers/cli.ts: /^VOCODER_AUTH_URL: (.+)$/m
    process.stdout.write(`VOCODER_AUTH_URL: ${browserUrl}\n`);
    // Also emit the session ID separately so tests can expire/complete sessions
    process.stdout.write(`VOCODER_SESSION_ID: ${session.sessionId}\n`);
  } else if (
    process.stdin.isTTY &&
    process.stdout.isTTY &&
    process.env.CI !== "true"
  ) {
    if (reauth) {
      // Re-auth: token expired, just sign in — no install choice needed
      if (!options.yes) {
        const shouldOpen = await p.confirm({
          message: "Open your browser to sign in again?",
        });
        if (p.isCancel(shouldOpen)) {
          server?.close();
          p.cancel("Setup cancelled.");
          return null;
        }
        if (!shouldOpen) {
          server?.close();
          p.cancel("Setup cancelled.");
          return null;
        } else {
          const opened = await tryOpenBrowser(browserUrl);
          if (!opened) {
            p.note(browserUrl, "Sign In");
            p.log.info("Open the URL above manually to continue.");
          }
        }
      } else {
        await tryOpenBrowser(browserUrl);
      }
    } else {
      // First-time setup: let user choose install vs link existing
      let isLinkFlow = false;
      if (!options.yes) {
        const connectChoice = await p.select<string>({
          message:
            "Vocoder needs to be installed on your GitHub account to get started",
          options: [
            {
              value: "install",
              label: "Install GitHub App",
              hint: "new user",
            },
            {
              value: "link",
              label: "Already installed? Link your account",
              hint: "returning user",
            },
          ],
        });

        if (p.isCancel(connectChoice)) {
          server?.close();
          p.cancel("Setup cancelled.");
          return null;
        }

        isLinkFlow = connectChoice === "link";
      }

      // For "link": get the OAuth-only URL from the server (no install page shown)
      let urlToOpen = browserUrl;
      if (isLinkFlow) {
        try {
          const linkSession = await api.startCliGitHubLinkSession(
            session.sessionId,
            server?.port,
          );
          urlToOpen = linkSession.oauthUrl;
        } catch {
          // Fall back to install URL if link-start fails
          urlToOpen = browserUrl;
        }
      }

      // Open browser immediately — no separate confirm needed
      const opened = await tryOpenBrowser(urlToOpen);
      if (!opened) {
        // Only show URL as a fallback if auto-open fails
        p.log.warn("Could not open your browser automatically.");
        p.note(urlToOpen, "GitHub");
        p.log.info("Open the URL above to continue.");
      }
    }
  }

  const authSpinner = p.spinner();
  authSpinner.start("Waiting for GitHub authorization...");

  let rawToken: string | null = null;
  let callbackOrganizationId: string | undefined;
  let callbackDiscoveryReady = false;

  const deadline = Math.min(expiresAt, Date.now() + 10 * 60 * 1000);
  let stopPolling = false;

  // Local server future — null if no server or on error
  const serverCallback: Promise<Record<string, string> | null> = server
    ? server.waitForCallback().catch(() => null)
    : Promise.resolve(null);

  // Polling runs concurrently with the server wait so a missed local-server
  // callback (browser blocked fetch, mixed-content, port conflict) doesn't
  // block for the full server timeout before the CLI gets the token.
  const sessionPoll = (async () => {
    while (!stopPolling && Date.now() < expiresAt) {
      try {
        const result = await api.pollCliAuthSession(session.sessionId);
        if (result.status === "complete" || result.status === "failed") {
          return result;
        }
      } catch {
        // transient network error — keep trying
      }
      if (!stopPolling) await sleep(2000);
    }
    return null;
  })();

  // Three-way race: local server, polling, hard deadline
  const winner = await new Promise<
    | { kind: "server"; params: Record<string, string> }
    | {
        kind: "poll";
        result:
          | { status: "complete"; token: string; organizationId?: string }
          | { status: "failed"; reason: string };
      }
    | null
  >((resolve) => {
    let done = false;

    serverCallback
      .then((params) => {
        if (done || params === null || typeof params.token !== "string") return;
        done = true;
        resolve({ kind: "server", params });
      })
      .catch(() => {});

    sessionPoll
      .then((result) => {
        if (done || result === null) return;
        if (result.status === "complete" || result.status === "failed") {
          done = true;
          resolve({
            kind: "poll",
            result: result as
              | { status: "complete"; token: string; organizationId?: string }
              | { status: "failed"; reason: string },
          });
        }
      })
      .catch(() => {});

    setTimeout(
      () => {
        if (!done) {
          done = true;
          resolve(null);
        }
      },
      Math.max(0, deadline - Date.now()),
    );
  });

  stopPolling = true;
  server?.close();

  if (winner !== null) {
    if (winner.kind === "server") {
      rawToken = winner.params.token;
      if (
        typeof winner.params.organizationId === "string" &&
        winner.params.organizationId
      ) {
        callbackOrganizationId = winner.params.organizationId;
      }
      if (winner.params.discovery_ready === "1") {
        callbackDiscoveryReady = true;
      }
    } else if (winner.result.status === "complete") {
      rawToken = winner.result.token;
      if (winner.result.organizationId) {
        callbackOrganizationId = winner.result.organizationId;
      }
    } else {
      authSpinner.stop();
      p.log.error(winner.result.reason);
      return null;
    }
  }

  if (!rawToken) {
    authSpinner.stop();
    p.log.error("The authentication link expired. Run `vocoder init` again.");
    return null;
  }

  // Validate the token and get user info
  const userInfo = await api.getCliUserInfo(rawToken);
  authSpinner.stop(`Authenticated as ${chalk.bold(userInfo.email)}`);

  return {
    token: rawToken,
    ...userInfo,
    organizationId: callbackOrganizationId,
    discoveryReady: callbackDiscoveryReady,
  };
}

// ── Main command ─────────────────────────────────────────────────────────────

export async function init(options: InitOptions = {}): Promise<number> {
  const apiUrl =
    options.apiUrl || process.env.VOCODER_API_URL || "https://vocoder.app";

  p.intro(chalk.bold("Vocoder Setup"));

  try {
    // ── Detect git context ──────────────────────────────────────────────────
    const gitContext = resolveGitContext();
    const identity = gitContext.identity;

    if (gitContext.warnings.length > 0) {
      for (const warning of gitContext.warnings) {
        p.log.warn(warning);
      }
    }

    // ── Fast lookup: does a project already exist for this repo? ────────────
    // No spinner — this is a fast DB read and we don't want an empty ◇ on miss.
    let existingAppsForRepo: Array<{
      appDir: string;
      appId: string;
      projectId: string;
      projectName: string;
      organizationName: string;
    }> = [];
    let repoProjectId: string | null = null;
    let repoProjectName: string | null = null;
    let lookup: Awaited<ReturnType<VocoderAPI["lookupAppByRepo"]>> | null =
      null;

    if (identity) {
      const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
      lookup = await anonApi.lookupAppByRepo({
        repoCanonical: identity.repoCanonical,
        appDir: "",
      });

      // Any apps found for this repo: unified "project already set up" routing.
      // All existingApps entries contain all configured apps for the repo.
      if (lookup.existingApps.length > 0) {
        const allApps = lookup.existingApps;
        const firstApp = allApps[0]!;

        p.log.success(`Project: ${chalk.bold(firstApp.projectName)}`);
        p.log.info(
          `Configured apps: ${allApps.map((a) => highlight(a.appDir || "(entire repo)")).join(", ")}`,
        );

        const routeAction = await p.select<string>({
          message: "This repo is already set up. What would you like to do?",
          options: [
            { value: "key", label: "Get an API key for this project" },
            { value: "add", label: "Add a new app directory" },
          ],
        });

        if (p.isCancel(routeAction)) {
          p.cancel("Setup cancelled.");
          return 1;
        }

        if (routeAction === "key") {
          const anonApi = new VocoderAPI({ apiUrl, apiKey: "" });
          const authResult = await runAuthFlow(anonApi, options, /* reauth */ true);
          if (!authResult) return 1;

          const spinner = p.spinner();
          spinner.start("Generating API key...");
          let apiKey: string;
          try {
            ({ apiKey } = await anonApi.regenerateProjectApiKey(
              authResult.token,
              firstApp.projectId,
            ));
            spinner.stop("API key ready");
          } catch (err) {
            spinner.stop("Failed to generate key");
            const msg = err instanceof Error ? err.message : String(err);
            p.log.error(`Could not generate API key: ${msg}`);
            p.log.info("Try again or generate one from the dashboard.");
            return 1;
          }

          printApiKey(apiKey, identity.repoRoot);

          const detection = detectLocalEcosystem();
          const targetBranches = lookup.exactMatch?.targetBranches ?? ["main"];
          writeAppConfigs(
            allApps.map((a) => ({ appDir: a.appDir, appId: a.appId })),
            targetBranches,
            detection.isTypeScript,
            identity.repoRoot,
          );

          p.outro("Vocoder is set up for this repository.");
          return 0;
        }

        // "add" path: fall through to runAppCreate block below.
        existingAppsForRepo = allApps;
        repoProjectId = firstApp.projectId;
        repoProjectName = firstApp.projectName;
      }
    }

    // ── Auth: check stored token, prompt if missing ─────────────────────────
    const api = new VocoderAPI({ apiUrl, apiKey: "" });
    let userToken: string;
    let userEmail: string;
    let userName: string | null;

    // organizationId is set when auth+GitHub install completed in one browser trip
    let authOrganizationId: string | undefined;

    const storedAuth = await verifyStoredAuth(api);

    if (storedAuth.status === "valid") {
      p.log.success(`Authenticated as ${chalk.bold(storedAuth.email)}`);
      userToken = storedAuth.token;
      userEmail = storedAuth.email;
      userName = storedAuth.name;
    } else {
      // "gone" = user deleted from DB → full first-time flow (installUrl)
      // "expired" = token rejected → reauth via verificationUrl (no new org)
      // "none" = no stored token → full first-time flow (installUrl)
      const reauth = storedAuth.status === "expired";
      if (reauth) {
        p.log.warn("Stored credentials expired — signing in again");
      } else if (storedAuth.status === "gone") {
        p.log.warn("Account not found — starting fresh setup");
      }
      const authResult = await runAuthFlow(
        api,
        options,
        reauth,
        identity?.repoCanonical,
      );
      if (!authResult) return 1;
      userToken = authResult.token;
      userEmail = authResult.email;
      userName = authResult.name;
      authOrganizationId = authResult.organizationId;

      writeAuthData({
        token: userToken,
        userId: authResult.userId,
        email: userEmail,
        name: userName,
        createdAt: new Date().toISOString(),
      });
    }

    // ── Workspace selection ─────────────────────────────────────────────────────
    let selectedOrganizationId: string;
    let selectedOrganizationName: string;

    // Fast path: repo is already linked to a workspace in our DB (git connection
    // exists but no project yet). Skip GitHub installation selection entirely —
    // the user just needs to create their first project in the known workspace.
    const repoOrgContext = identity
      ? (lookup?.organizationContext ?? null)
      : null;

    if (authOrganizationId) {
      // Install path: auth+install completed in one browser trip, workspace already created.
      const organizationData = await api.listOrganizations(userToken);
      const ws = organizationData.organizations.find(
        (w) => w.id === authOrganizationId,
      );
      selectedOrganizationId = authOrganizationId;
      selectedOrganizationName = ws?.name ?? userEmail;
      p.log.success(
        `Connected as ${chalk.bold(userEmail)} — workspace: ${chalk.bold(selectedOrganizationName)}`,
      );
    } else if (repoOrgContext && !repoProjectId) {
      // Repo is already linked to a workspace (git connection exists) but no project
      // created yet. Skip GitHub installation selection — use the known workspace.
      selectedOrganizationId = repoOrgContext.organizationId;
      selectedOrganizationName = repoOrgContext.organizationName;
      p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
    } else {
      // ── Repo-aware workspace resolution ──────────────────────────────────────
      // Always resolve org membership first. cachedInstallations (fresh GitHub App
      // installs) are only consulted when the user has zero existing connections —
      // this prevents "already connected to another organization" errors for users
      // who have an org but haven't created a project yet.
      const organizationData = await api.listOrganizations(userToken, {
        repo: identity?.repoCanonical,
      });

      {
        const repoCanonical = identity?.repoCanonical ?? null;
        // Workspaces whose GitHub installation covers the current repo
        const covering = repoCanonical
          ? organizationData.organizations.filter((w) => w.coversRepo === true)
          : [];
        // Workspaces that have any GitHub connection (may not cover this repo)
        const connected = organizationData.organizations.filter(
          (w) => w.hasGitHubConnection,
        );

        if (repoCanonical && covering.length === 1) {
          // ── Scenario 1: exactly one workspace covers this repo — auto-select ──
          const ws = covering[0]!;
          selectedOrganizationId = ws.id;
          selectedOrganizationName = ws.name;
          p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
        } else if (repoCanonical && covering.length > 1) {
          // ── Scenario 2: multiple workspaces cover this repo — let user pick ──
          const choice = await p.select<string>({
            message: "Select workspace for this repo",
            options: covering.map((w) => ({
              value: w.id,
              label: `${w.name}  ${chalk.dim(`(${w.appCount} app${w.appCount !== 1 ? "s" : ""})`)}`,
            })),
          });
          if (p.isCancel(choice)) {
            p.cancel("Setup cancelled.");
            return 1;
          }
          const ws = covering.find((w) => w.id === choice)!;
          selectedOrganizationId = ws.id;
          selectedOrganizationName = ws.name;
          p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
        } else if (
          repoCanonical &&
          covering.length === 0 &&
          connected.length > 0
        ) {
          // ── Scenario 3: connected workspaces exist but none cover this repo ──
          const shortRepo = repoCanonical.split(":")[1] ?? repoCanonical;
          p.log.warn(
            `${chalk.bold(shortRepo)} isn't accessible from your Vocoder installation.\n` +
              `  Grant access to this repository or install on the account that owns it.`,
          );

          const fixOptions: Array<{ value: string; label: string }> = [];
          for (const ws of connected) {
            if (ws.installationConfigureUrl) {
              fixOptions.push({
                value: `grant:${ws.id}`,
                label: `Configure ${chalk.bold(ws.connectionLabel ?? ws.name)}'s GitHub App installation`,
              });
            }
          }
          fixOptions.push({
            value: "install_new",
            label: `Install on a different GitHub account ${chalk.dim("(creates a new personal workspace)")}`,
          });
          fixOptions.push({ value: "cancel", label: "Cancel" });

          const fix = await p.select<string>({
            message: "How would you like to fix this?",
            options: fixOptions,
          });

          if (p.isCancel(fix) || fix === "cancel") {
            p.cancel("Setup cancelled.");
            return 1;
          }

          if (fix.startsWith("grant:")) {
            const ws = connected.find((w) => `grant:${w.id}` === fix)!;
            await tryOpenBrowser(ws.installationConfigureUrl!);
            p.cancel(
              `Grant access to ${chalk.bold(shortRepo)} in your browser,\n` +
                `  then re-run ${chalk.bold("vocoder init")}.`,
            );
            return 1;
          }

          // install_new: full install → creates new workspace covering the new account
          const connectResult = await runGitHubInstallFlow({
            api,
            userToken,
            yes: options.yes,
          });
          if (!connectResult) {
            p.log.error(
              "GitHub App installation did not complete. Run `vocoder init` again.",
            );
            return 1;
          }
          selectedOrganizationId = connectResult.organizationId;
          selectedOrganizationName = connectResult.organizationName;
          p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
        } else {
          // ── Fallback: no existing connections — first-time user ───────────────
          // Only now check for a fresh cached GitHub App installation. We reach
          // this path only when covering === 0 && connected === 0, so claiming
          // a cached installation can never error with "already connected".
          const discoveryResult = await api
            .getCliGitHubDiscovery(userToken)
            .catch(() => null);
          const cachedInstallations = discoveryResult?.installations ?? [];

          if (cachedInstallations.length > 0) {
            if (identity?.repoCanonical) {
              const repoOwner = identity.repoCanonical
                .split(":")[1]
                ?.split("/")[0]
                ?.toLowerCase();
              if (repoOwner) {
                const hasMatchingAccount = cachedInstallations.some(
                  (i) => i.accountLogin.toLowerCase() === repoOwner,
                );
                if (!hasMatchingAccount) {
                  p.log.warn(
                    `None of your GitHub App installations belong to "${repoOwner}", ` +
                      `the account that owns this repository.\n` +
                      `  The project will be created but translations won't trigger automatically.\n` +
                      `  To fix: install the Vocoder GitHub App on "${repoOwner}" instead.`,
                  );
                }
              }
            }

            const validInstallations = cachedInstallations.filter(
              (i) => !i.isSuspended && !i.conflictLabel,
            );
            let selectedInstallationId: number | string | null = null;
            if (
              validInstallations.length === 1 &&
              cachedInstallations.length === 1
            ) {
              selectedInstallationId = validInstallations[0]!.installationId;
            } else {
              selectedInstallationId = await selectGitHubInstallation(
                cachedInstallations.map((inst) => ({
                  installationId: inst.installationId,
                  accountLogin: inst.accountLogin,
                  accountType: inst.accountType,
                  isSuspended: inst.isSuspended,
                  conflictLabel: inst.conflictLabel,
                })),
                false,
              );
            }
            if (
              selectedInstallationId === null ||
              selectedInstallationId === "install_new"
            ) {
              p.cancel(
                "Setup cancelled. Re-run `vocoder init` and choose Install GitHub App.",
              );
              return 1;
            }
            const claimResult = await api.claimCliGitHubInstallation(
              userToken,
              {
                installationId: String(selectedInstallationId),
                organizationId: null,
              },
            );
            selectedOrganizationId = claimResult.organizationId;
            selectedOrganizationName = claimResult.organizationName;
            p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
          } else if (
            organizationData.organizations.length === 1 &&
            !organizationData.canCreateOrganization
          ) {
            const ws = organizationData.organizations[0]!;
            selectedOrganizationId = ws.id;
            selectedOrganizationName = ws.name;
            p.log.success(`Workspace: ${chalk.bold(selectedOrganizationName)}`);
          } else {
            const organizationResult =
              await selectOrganization(organizationData);

            if (organizationResult.action === "cancelled") {
              p.cancel("Setup cancelled.");
              return 1;
            }

            if (organizationResult.action === "use") {
              selectedOrganizationId = organizationResult.organization.id;
              selectedOrganizationName = organizationResult.organization.name;
              p.log.success(
                `Workspace: ${chalk.bold(selectedOrganizationName)}`,
              );
            } else {
              // ── New workspace: GitHub connect flow ────────────────────────────────
              const connectChoice = await p.select<string>({
                message: "Connect your new workspace to GitHub",
                options: [
                  { value: "install", label: "Install the Vocoder GitHub App" },
                  { value: "link", label: "Link an existing installation" },
                ],
              });

              if (p.isCancel(connectChoice)) {
                p.cancel("Setup cancelled.");
                return 1;
              }

              if (connectChoice === "install") {
                const connectResult = await runGitHubInstallFlow({
                  api,
                  userToken,
                  yes: options.yes,
                });
                if (!connectResult) {
                  p.log.error(
                    "GitHub App installation did not complete. Run `vocoder init` again.",
                  );
                  return 1;
                }
                selectedOrganizationId = connectResult.organizationId;
                selectedOrganizationName = connectResult.organizationName;
                p.log.success(
                  `Workspace: ${chalk.bold(selectedOrganizationName)}`,
                );
              } else {
                const installations = await runGitHubDiscoveryFlow({
                  api,
                  userToken,
                  yes: options.yes,
                });
                if (!installations) return 1;

                if (installations.length === 0) {
                  p.log.warn(
                    "No GitHub installations found. Install the Vocoder GitHub App first.",
                  );
                  const installNow = await p.confirm({
                    message: "Open GitHub to install the App?",
                  });
                  if (p.isCancel(installNow) || !installNow) return 1;
                  const connectResult = await runGitHubInstallFlow({
                    api,
                    userToken,
                    yes: options.yes,
                  });
                  if (!connectResult) return 1;
                  selectedOrganizationId = connectResult.organizationId;
                  selectedOrganizationName = connectResult.organizationName;
                } else {
                  const selectedInstallationId = await selectGitHubInstallation(
                    installations.map((inst) => ({
                      installationId: inst.installationId,
                      accountLogin: inst.accountLogin,
                      accountType: inst.accountType,
                      isSuspended: inst.isSuspended,
                      conflictLabel: inst.conflictLabel,
                    })),
                    true,
                  );

                  if (selectedInstallationId === null) {
                    p.cancel("Setup cancelled.");
                    return 1;
                  }

                  if (selectedInstallationId === "install_new") {
                    const connectResult = await runGitHubInstallFlow({
                      api,
                      userToken,
                      yes: options.yes,
                    });
                    if (!connectResult) return 1;
                    selectedOrganizationId = connectResult.organizationId;
                    selectedOrganizationName = connectResult.organizationName;
                  } else {
                    const claimResult = await api.claimCliGitHubInstallation(
                      userToken,
                      {
                        installationId: String(selectedInstallationId),
                        organizationId: null,
                      },
                    );
                    selectedOrganizationId = claimResult.organizationId;
                    selectedOrganizationName = claimResult.organizationName;
                  }
                }
                p.log.success(
                  `Workspace: ${chalk.bold(selectedOrganizationName)}`,
                );
              }
            } // closes new workspace else
          } // closes auto-select else
        } // closes main scenario if/else chain
      } // closes cachedInstallations else
    } // closes if (authOrganizationId) else

    // ── Add-app path: repo already has a project with scoped apps ───────────────
    // Skip plan limit check — we're adding an App to an existing project,
    // not creating a new one. Run the project config prompts then call
    // POST /api/cli/apps.
    if (repoProjectId && repoProjectName && existingAppsForRepo.length > 0) {
      const appResult = await runAppCreate({
        api,
        userToken,
        projectId: repoProjectId,
        projectName: repoProjectName,
        organizationName: selectedOrganizationName,
        repoCanonical: identity?.repoCanonical,
        existingApps: existingAppsForRepo,
      });

      if (!appResult) {
        p.log.error("App setup failed. Run `vocoder init` again.");
        return 1;
      }

      const detection = detectLocalEcosystem();
      runScaffold({ targetBranches: appResult.targetBranches });
      writeAppConfigs(
        [{ appDir: appResult.appDir, appId: appResult.appId }],
        appResult.targetBranches,
        detection.isTypeScript,
        identity?.repoRoot,
      );
      p.log.info(
        chalk.dim("Use the VOCODER_API_KEY already in your root .env"),
      );
      p.outro("You're all set.");
      return 0;
    }

    // ── Plan limit pre-flight ────────────────────────────────────────────────────
    // Compute remaining app slots to enforce the limit in the app directory TUI.
    // Silently ignored on error — the server enforces the limit on creation too.
    let remainingApps: number | undefined;
    try {
      const wsCheck = await api.listOrganizations(userToken);
      const ws = wsCheck.organizations.find(
        (w) => w.id === selectedOrganizationId,
      );
      if (ws) {
        if (ws.maxApps !== -1 && ws.appCount >= ws.maxApps) {
          p.log.warn(
            `App limit reached — ${ws.appCount}/${ws.maxApps} on your ${chalk.bold(ws.planId)} plan.`,
          );

          const limitAction = await p.select<string>({
            message: "What would you like to do?",
            options: [
              { value: "upgrade", label: "Upgrade plan" },
              { value: "cancel", label: "Cancel" },
            ],
          });

          if (p.isCancel(limitAction) || limitAction === "cancel") {
            p.cancel("Setup cancelled.");
            return 1;
          }

          await tryOpenBrowser(`${apiUrl}${SUBSCRIPTION_SETTINGS_PATH}`);
          p.cancel(
            "Upgrade your plan in the browser, then re-run `vocoder init`.",
          );
          return 1;
        }
        remainingApps = ws.maxApps === -1 ? undefined : Math.max(0, ws.maxApps - ws.appCount);
      }
    } catch {
      p.log.warn("Could not verify plan limits — proceeding, the server will enforce them.");
    }

    // ── Project configuration ────────────────────────────────────────────────────
    const projectResult = await runProjectCreate({
      api,
      userToken,
      organizationId: selectedOrganizationId,
      defaultName: identity?.repoCanonical
        ? identity.repoCanonical.split("/").pop()
        : undefined,
      defaultSourceLocale: "en",
      repoCanonical: identity?.repoCanonical,
      repoRoot: identity?.repoRoot,
      defaultBranches: ["main"],
      maxAppDirs: remainingApps,
    });

    // null means user cancelled a prompt — individual steps already logged.
    if (!projectResult) return 1;

    // Warn if the current repo isn't accessible to the GitHub App installation.
    // This means translations won't trigger on push until the App is granted access.
    if (!projectResult.repositoryBound && identity?.repoCanonical) {
      p.log.warn(
        `This repository isn't accessible to your GitHub App installation.\n` +
          `Translations won't run automatically until you grant access.\n\n` +
          `  To fix: go to your GitHub App installation settings and add this\n` +
          `  repository to the allowed list, or switch to "All repositories".\n` +
          (projectResult.configureUrl
            ? `\n  ${chalk.dim(projectResult.configureUrl)}\n`
            : ""),
      );
    }

    // ── Scaffold: ecosystem detection, install instructions, setup snippets ──────
    const detection = detectLocalEcosystem();
    runScaffold({ targetBranches: projectResult.targetBranches });

    // ── Write per-app config files and the shared project key ────────────────────
    writeAppConfigs(
      projectResult.apps,
      projectResult.targetBranches,
      detection.isTypeScript,
      identity?.repoRoot,
    );
    printApiKey(projectResult.apiKey, identity?.repoRoot);

    const wantsMcp = await p.confirm({
      message: "Set up the Vocoder MCP server for your AI editor?",
    });
    if (!p.isCancel(wantsMcp) && wantsMcp) {
      await runMcpSetup(projectResult.apiKey);
    }

    p.outro("You're all set.");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown setup error";
    if (isPlanLimitFailure(message)) {
      printPlanLimitMessage(apiUrl, message);
    } else {
      p.log.error(message);
    }
    return 1;
  }
}
