/**
 * pi-hud: claude-hud style two-line footer for pi.
 * Event and session-usage handling follows pi-cometix-footer (MIT, Xichun123).
 * Edit, then /reload in pi.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { parseGitPorcelain, renderLines, type GitStatus } from "./render.ts";

const GIT_TTL = 3000;
const CLEAN: GitStatus = { dirty: false, ahead: 0, behind: 0 };

export default function (pi: ExtensionAPI) {
	let disposeFooter: (() => void) | undefined;
	let requestFooterRender: (() => void) | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;

	let taskStartedAt: number | undefined;
	let lastTaskMs: number | undefined;
	let firstOutputAt: number | undefined;
	let lastTps: number | undefined;

	function stopTicker(): void {
		if (ticker) clearInterval(ticker);
		ticker = undefined;
	}

	function startTicker(): void {
		stopTicker();
		if (taskStartedAt !== undefined && requestFooterRender) ticker = setInterval(() => requestFooterRender?.(), 1000);
	}

	function sessionUsage(ctx: ExtensionContext) {
		let tokensIn = 0;
		let tokensOut = 0;
		let cost = 0;
		let cacheHit: number | undefined;
		// Whole session file, like pi-cometix-footer: includes tool, compaction and summary usage.
		for (const e of ctx.sessionManager.getEntries()) {
			const u = e.type === "message"
				? (e.message.role === "assistant" || e.message.role === "toolResult" ? e.message.usage : undefined)
				: ("usage" in e ? e.usage : undefined);
			if (!u) continue;
			tokensIn += u.input ?? 0;
			tokensOut += u.output ?? 0;
			cost += u.cost?.total ?? 0;
			if (e.type === "message" && e.message.role === "assistant") {
				const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
				cacheHit = prompt > 0 ? ((u.cacheRead ?? 0) / prompt) * 100 : undefined;
			}
		}
		return { tokensIn, tokensOut, cost, cacheHit };
	}

	function installFooter(ctx: ExtensionContext): void {
		disposeFooter?.();
		ctx.ui.setFooter((tui, theme, footerData) => {
			let disposed = false;
			let gitRequest: AbortController | undefined;
			let git = { ts: 0, data: CLEAN };
			const requestRender = () => {
				if (!disposed) tui.requestRender();
			};

			async function refreshGit(): Promise<void> {
				if (disposed || gitRequest) return;
				const branch = footerData.getGitBranch();
				if (!branch) {
					git = { ts: Date.now(), data: CLEAN };
					return;
				}
				const request = new AbortController();
				gitRequest = request;
				try {
					const r = await pi.exec("git", ["status", "-b", "--porcelain=v1"], {
						cwd: ctx.cwd,
						timeout: 3000,
						signal: request.signal,
					});
					if (!disposed && !request.signal.aborted && branch === footerData.getGitBranch()) {
						git = { ts: Date.now(), data: r.code === 0 ? parseGitPorcelain(r.stdout) : git.data };
					}
				} catch {
					// Keep the previous status; the next render past GIT_TTL retries.
					if (!disposed && !request.signal.aborted) git.ts = Date.now();
				} finally {
					if (gitRequest === request) {
						gitRequest = undefined;
						requestRender();
					}
				}
			}

			const unsubBranch = footerData.onBranchChange(() => {
				gitRequest?.abort();
				gitRequest = undefined;
				git = { ts: 0, data: CLEAN };
				void refreshGit();
			});
			const timer = setInterval(() => void refreshGit(), GIT_TTL);
			const dispose = () => {
				if (disposed) return;
				disposed = true;
				clearInterval(timer);
				gitRequest?.abort();
				unsubBranch();
				if (requestFooterRender === requestRender) {
					stopTicker();
					requestFooterRender = undefined;
				}
				if (disposeFooter === dispose) disposeFooter = undefined;
			};
			disposeFooter = dispose;
			requestFooterRender = requestRender;
			startTicker();

			return {
				invalidate() {},
				dispose,
				render(width: number): string[] {
					const now = Date.now();
					if (now - git.ts > GIT_TTL) void refreshGit();

					const lvl = pi.getThinkingLevel();
					const cu = ctx.getContextUsage();
					const statuses = Array.from(footerData.getExtensionStatuses().entries())
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([, t]) => t ?? "");

					const lines = renderLines({
						model: ctx.model?.name || ctx.model?.id || "no-model",
						provider: ctx.model?.provider,
						level: ctx.model?.reasoning && lvl && lvl !== "off" ? theme.getThinkingBorderColor(lvl)(lvl) : undefined,
						cwd: ctx.sessionManager.getCwd(),
						home: process.env.HOME || process.env.USERPROFILE,
						branch: footerData.getGitBranch() ?? undefined,
						git: git.data,
						context: { percent: cu?.percent ?? undefined, tokens: cu?.tokens ?? undefined, window: cu?.contextWindow },
						...sessionUsage(ctx),
						tps: lastTps,
						durationMs: taskStartedAt != null ? now - taskStartedAt : lastTaskMs,
						statuses,
					}, width);
					return lines.map((line) => truncateToWidth(line, width, ""));
				},
			};
		});
	}

	pi.on("message_start", (event) => {
		if (event.message.role === "user") {
			taskStartedAt = event.message.timestamp;
			lastTaskMs = undefined;
			lastTps = undefined;
			startTicker();
			requestFooterRender?.();
		} else if (event.message.role === "assistant") {
			firstOutputAt = undefined;
		}
	});

	pi.on("message_update", (event) => {
		if (event.message.role !== "assistant" || firstOutputAt !== undefined) return;
		const u = event.assistantMessageEvent;
		if ((u.type === "text_delta" || u.type === "thinking_delta" || u.type === "toolcall_delta") && u.delta.length > 0) {
			firstOutputAt = Date.now();
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		// TPS excludes time to first token; omitted when the provider streams no deltas or reports no output.
		const elapsed = firstOutputAt === undefined ? 0 : Date.now() - firstOutputAt;
		const out = event.message.usage.output;
		lastTps = elapsed > 0 && out > 0 ? out / (elapsed / 1000) : undefined;
		firstOutputAt = undefined;
		requestFooterRender?.();
	});

	pi.on("agent_settled", () => {
		if (taskStartedAt === undefined) return;
		lastTaskMs = Math.max(0, Date.now() - taskStartedAt);
		taskStartedAt = undefined;
		stopTicker();
		requestFooterRender?.();
	});

	pi.on("session_shutdown", () => {
		disposeFooter?.();
		stopTicker();
		taskStartedAt = undefined;
	});

	pi.on("session_start", (_event, ctx) => {
		disposeFooter?.();
		stopTicker();
		taskStartedAt = undefined;
		lastTaskMs = undefined;
		lastTps = undefined;
		firstOutputAt = undefined;
		if (ctx.mode === "tui") installFooter(ctx);
	});
}
