import assert from "node:assert/strict";
import { join, parse, resolve } from "node:path";
import { test } from "node:test";
import { barWidth, contextBar, fmtDuration, fmtTok, parseGitPorcelain, projectName, renderLines, type HudData } from "./render.ts";

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

// Native paths, so the same tests hold on Windows and Linux.
const root = parse(process.cwd()).root;
const home = join(root, "Users", "me");
const project = join(root, "Development", "Local", "harness");

const base: HudData = {
	model: "GPT-5.6 Sol",
	cwd: project,
	home,
	tokensIn: 13_000,
	tokensOut: 61,
	cost: 0,
	statuses: [],
};

test("project shows only the last path segment", () => {
	assert.equal(projectName(project, home), "harness");
	assert.equal(projectName(join(home, ".pi", "agent"), home), "agent");
	assert.equal(projectName(home, home), "~");
	assert.equal(projectName(root, home), resolve(root));
});

test("formatters", () => {
	assert.equal(fmtTok(999), "999");
	assert.equal(fmtTok(6400), "6.4k");
	assert.equal(fmtTok(372_000), "372k");
	assert.equal(fmtTok(1_200_000), "1.2M");
	assert.equal(fmtDuration(83_000), "1m 23s");
	assert.equal(fmtDuration(3_720_000), "1h 2m");
});

test("context bar fills by percent and narrows on small terminals", () => {
	assert.equal(strip(contextBar(12, 10)), "▰▱▱▱▱▱▱▱▱▱");
	assert.equal(strip(contextBar(150, 4)), "▰▰▰▰");
	assert.deepEqual([barWidth(120), barWidth(80), barWidth(40)], [10, 6, 4]);
	assert.match(contextBar(90, 10), /\x1b\[31m/);
	assert.match(contextBar(75, 10), /\x1b\[33m/);
});

test("git porcelain", () => {
	assert.deepEqual(parseGitPorcelain("## main...origin/main [ahead 2, behind 1]\n M a.ts\n"), { dirty: true, ahead: 2, behind: 1 });
	assert.deepEqual(parseGitPorcelain("## main\n"), { dirty: false, ahead: 0, behind: 0 });
});

test("renders the two claude-hud lines", () => {
	const lines = renderLines({
		...base,
		provider: "gs-o",
		level: "high",
		branch: "main",
		git: { dirty: true, ahead: 0, behind: 0 },
		context: { percent: 12, tokens: 45_000, window: 372_000 },
		cacheHit: 88.2,
		cost: 0.284,
		tps: 42.3,
		durationMs: 83_000,
		statuses: ["MCP: 1 server enabled"],
	}, 120).map(strip);
	assert.deepEqual(lines, [
		"[GPT-5.6 Sol • high | gs-o] │ harness git:(main*) │ 1m 23s · 42.3 tok/s",
		"上下文 ▰▱▱▱▱▱▱▱▱▱ 12% 45k/372k │ ↑13k ↓61 缓存 88% │ $0.284 │ MCP: 1 server enabled",
	]);
});

test("duration and speed share one part on the first line and each may be missing", () => {
	const only = (extra: Partial<HudData>) => strip(renderLines({ ...base, ...extra }, 120)[0]).split(" │ ").at(-1);
	assert.equal(only({ durationMs: 5_000 }), "5s");
	assert.equal(only({ tps: 150.4 }), "150 tok/s");
});

test("extension statuses lose their own icon and color and use the HUD label style", () => {
	const lines = renderLines({ ...base, statuses: ["\x1b[36m🔌 MCP: 1 server enabled\x1b[39m", "\x1b[94m bg 2 running \x1b[0m", "  "] }, 120);
	assert.ok(lines[1].endsWith(" │ \x1b[2mMCP: 1 server enabled\x1b[0m │ \x1b[2mbg 2 running\x1b[0m"), lines[1]);
});

test("optional parts disappear without leftover separators and never add a third line", () => {
	const lines = renderLines({ ...base, statuses: ["MCP: 5/5"] }, 50).map(strip);
	assert.deepEqual(lines, ["[GPT-5.6 Sol] │ harness", "上下文 ▱▱▱▱ ? │ ↑13k ↓61 │ MCP: 5/5"]);
});
