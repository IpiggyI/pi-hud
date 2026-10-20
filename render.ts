/**
 * Pure formatting for the pi-hud footer. No pi imports, so it runs under `node --test`.
 * Look follows claude-hud's expanded layout; colors follow ~/.claude/plugins/claude-hud/config.json.
 */
import { basename, resolve } from "node:path";

export const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const fg256 = (n: number) => `\x1b[38;5;${n}m`;

export const COLORS = {
	model: fg256(208),
	project: fg256(142),
	git: "\x1b[35m",
	gitBranch: fg256(109),
	context: "\x1b[32m",
	warning: "\x1b[33m",
	critical: "\x1b[31m",
	usage: "\x1b[94m",
	label: DIM,
};

const BAR_FILLED = "▰";
const BAR_EMPTY = "▱";
const SEP = " │ ";

const paint = (color: string, s: string) => `${color}${s}${RESET}`;

export function projectName(cwd: string, home: string | undefined): string {
	const abs = resolve(cwd);
	if (home && resolve(home) === abs) return "~";
	return basename(abs) || abs;
}

export function fmtTok(n: number): string {
	if (n < 1000) return String(n);
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	return `${Math.round(n / 1_000_000)}M`;
}

export function fmtDuration(ms: number): string {
	const total = Math.round(Math.max(0, ms) / 1000);
	if (total < 60) return `${total}s`;
	const m = Math.floor(total / 60);
	if (m < 60) return `${m}m ${total % 60}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function contextColor(percent: number): string {
	if (percent >= 85) return COLORS.critical;
	if (percent >= 70) return COLORS.warning;
	return COLORS.context;
}

/** Same width steps as claude-hud: 10 cells at >= 100 columns, 6 at >= 60, else 4. */
export function barWidth(columns: number): number {
	return columns >= 100 ? 10 : columns >= 60 ? 6 : 4;
}

export function contextBar(percent: number, width: number): string {
	const p = Math.min(100, Math.max(0, percent));
	const filled = Math.round((p / 100) * width);
	return `${contextColor(p)}${BAR_FILLED.repeat(filled)}${DIM}${BAR_EMPTY.repeat(width - filled)}${RESET}`;
}

export interface GitStatus {
	dirty: boolean;
	ahead: number;
	behind: number;
}

export function parseGitPorcelain(out: string): GitStatus {
	const s: GitStatus = { dirty: false, ahead: 0, behind: 0 };
	for (const line of out.split("\n")) {
		if (line.startsWith("## ")) {
			s.ahead = Number(line.match(/ahead (\d+)/)?.[1] ?? 0);
			s.behind = Number(line.match(/behind (\d+)/)?.[1] ?? 0);
		} else if (line.trim().length > 0) {
			s.dirty = true;
		}
	}
	return s;
}

export interface HudData {
	model: string;
	/** pi provider id, e.g. "gs-o"; the same model name can come from several providers. */
	provider?: string;
	/** Thinking level, already colored by the caller; omitted when off or unsupported. */
	level?: string;
	cwd: string;
	home?: string;
	branch?: string;
	git?: GitStatus;
	context?: { percent?: number; tokens?: number; window?: number };
	tokensIn: number;
	tokensOut: number;
	cacheHit?: number;
	cost: number;
	tps?: number;
	durationMs?: number;
	statuses: string[];
}

export function renderLines(d: HudData, columns: number): string[] {
	const level = d.level ? `${COLORS.label} • ${RESET}${d.level}` : "";
	const provider = d.provider ? `${COLORS.label} | ${RESET}${paint(COLORS.model, d.provider)}` : "";
	const top = [`${paint(COLORS.model, `[${d.model}`)}${level}${provider}${paint(COLORS.model, "]")}`];
	let project = paint(COLORS.project, projectName(d.cwd, d.home));
	if (d.branch) {
		const inner = [paint(COLORS.gitBranch, `${d.branch}${d.git?.dirty ? "*" : ""}`)];
		if (d.git?.ahead) inner.push(paint(COLORS.gitBranch, `↑${d.git.ahead}`));
		if (d.git?.behind) inner.push(paint(COLORS.gitBranch, `↓${d.git.behind}`));
		project += ` ${paint(COLORS.git, "git:(")}${inner.join(" ")}${paint(COLORS.git, ")")}`;
	}
	top.push(project);
	const activity = [
		d.durationMs != null ? fmtDuration(d.durationMs) : "",
		d.tps != null ? `${d.tps < 100 ? d.tps.toFixed(1) : Math.round(d.tps)} tok/s` : "",
	].filter(Boolean);
	if (activity.length > 0) top.push(paint(COLORS.label, activity.join(" · ")));

	const pct = d.context?.percent;
	const tok = d.context?.tokens != null ? fmtTok(d.context.tokens) : "?";
	const win = d.context?.window ? fmtTok(d.context.window) : "?";
	const ctxValue = pct != null ? paint(contextColor(pct), `${Math.round(pct)}% ${tok}/${win}`) : paint(COLORS.label, "?");
	const bottom = [`${paint(COLORS.label, "上下文")} ${contextBar(pct ?? 0, barWidth(columns))} ${ctxValue}`];

	let usage = `↑${fmtTok(d.tokensIn)} ↓${fmtTok(d.tokensOut)}`;
	if (d.cacheHit != null) usage += ` ${COLORS.label}缓存${RESET}${COLORS.usage} ${Math.round(d.cacheHit)}%`;
	bottom.push(paint(COLORS.usage, usage));
	if (d.cost > 0) bottom.push(paint(COLORS.warning, `$${d.cost.toFixed(3)}`));
	for (const s of d.statuses.map(plainStatus).filter(Boolean)) bottom.push(paint(COLORS.label, s));

	return [top.join(SEP), bottom.join(SEP)];
}

/** Extension statuses carry their own colors and icons; drop both so the line matches the HUD style. */
export function plainStatus(text: string): string {
	return text
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\p{Extended_Pictographic}️?\s*/u, "");
}
