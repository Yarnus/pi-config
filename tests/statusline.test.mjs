import assert from "node:assert/strict";
import test from "node:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { visibleWidth } from "@earendil-works/pi-tui";
import statuslineExtension, { renderStatusLines } from "../agent/extensions/statusline/index.ts";

const snapshot = {
	cwd: join(homedir(), "code/my-pi"),
	branch: "master",
	provider: "chrono",
	model: "gpt-5.6-sol",
	thinkingLevel: "medium",
	totalInput: 12450,
	totalOutput: 3100,
	cacheRead: 3000,
	cacheWrite: 0,
	contextTokens: 53000,
	contextWindow: 272000,
	contextPercent: 19.5,
};

function render(width, overrides = {}) {
	return renderStatusLines({ ...snapshot, ...overrides }, width);
}

test("uses cool theme colors for location and keeps metrics subdued", () => {
	const handlers = new Map();
	const painted = new Map();
	let footer;
	statuslineExtension({
		on: (event, handler) => handlers.set(event, handler),
		getThinkingLevel: () => "medium",
	});
	handlers.get("session_start")({}, {
		mode: "tui",
		cwd: snapshot.cwd,
		model: { id: snapshot.model, provider: snapshot.provider },
		sessionManager: { getBranch: () => [] },
		ui: {
			setFooter(factory) {
				footer = factory(
					{ requestRender() {} },
					{ fg(color, text) { painted.set(text, color); return text; } },
					{ getGitBranch: () => "master", onBranchChange: () => () => {} },
				);
			},
		},
	});
	footer.render(140);
	assert.equal(painted.get("󰉋 ~/code/my-pi"), "mdLink");
	assert.equal(painted.get(" master"), "accent");
	assert.equal(painted.get("≋ medium"), "mdLink");
	assert.equal(painted.get("↑ 0"), "muted");
	assert.equal(painted.get("↓ 0"), "muted");
	assert.equal(painted.get("  ·  "), "dim");
	footer.dispose();
});

test("renders a responsive two-line wide layout", () => {
	const lines = render(140);
	assert.equal(lines.length, 2);
	assert.match(lines[0], /~\/code\/my-pi/);
	assert.match(lines[0], /󰉋 ~\/code\/my-pi/);
	assert.match(lines[0], / master/);
	assert.match(lines[0], /● gpt-5\.6-sol/);
	assert.match(lines[0], /≋ medium/);
	assert.match(lines[0], /gpt-5\.6-sol chrono/);
	assert.match(lines[0], /medium$/);
	assert.match(lines[1], /↑ 12k  ↓ 3\.1k/);
	assert.match(lines[1], /cache 3\.0k \(5\.7%\)/);
	assert.match(lines[1], /ctx 53k\/272k \(20%\)/);
	assert.doesNotMatch(lines[1], /tok\/s|≈|\$/);
	assert.equal(visibleWidth(lines[0]), 140);
	assert.equal(visibleWidth(lines[1]), 140);
});

test("drops cache details at medium widths", () => {
	const lines = render(90);
	assert.equal(lines.length, 2);
	assert.doesNotMatch(lines[1], /cache/);
	assert.doesNotMatch(lines[1], /tok\/s|≈|\$/);
	assert.ok(lines.every((line) => visibleWidth(line) <= 90));
});

test("keeps the essential fields at narrow widths", () => {
	const lines = render(64);
	assert.equal(lines.length, 2);
	assert.match(lines[0], /~\/code\/my-pi/);
	assert.match(lines[0], /gpt-5\.6-sol chrono/);
	assert.doesNotMatch(lines[0], / master/);
	assert.doesNotMatch(lines[0], /medium/);
	assert.match(lines[1], /↑ 12k  ↓ 3\.1k/);
	assert.match(lines[1], /ctx 53k\/272k \(20%\)/);
	assert.doesNotMatch(lines[1], /tok\/s|≈|\$/);
	assert.ok(lines.every((line) => visibleWidth(line) <= 64));
});

test("truncates safely at very narrow widths", () => {
	for (const width of [1, 8, 20, 40]) {
		const lines = render(width);
		assert.equal(lines.length, 2);
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
	}
});

test("shows unavailable metrics explicitly", () => {
	const lines = render(140, {
		cacheRead: null,
		contextTokens: null,
		contextWindow: null,
		contextPercent: null,
	});
	assert.doesNotMatch(lines[1], /cache/);
	assert.match(lines[1], /ctx \?/);
	assert.doesNotMatch(lines[1], /tok\/s|≈|\$/);
});

test("keeps long Unicode paths and model names within the terminal width", () => {
	for (const width of [0, 1, 40, 64, 78, 90, 110, 140]) {
		const lines = render(width, {
			cwd: "/projects/很长的项目名称/".repeat(8),
			model: "long-model-name-".repeat(10),
		});
		assert.ok(lines.every((line) => visibleWidth(line) <= width));
	}
});

test("uses neutral metrics with semantic context warnings", () => {
	const colors = new Map();
	const paint = (color, text) => { colors.set(color, text); return text; };
	renderStatusLines({ ...snapshot, contextPercent: 75 }, 140, paint);
	assert.match(colors.get("contextWarning"), /75%/);
	renderStatusLines({ ...snapshot, contextPercent: 95 }, 140, paint);
	assert.match(colors.get("contextDanger"), /95%/);
	assert.equal(colors.get("thinking"), "≋ medium");
	assert.equal(colors.get("model"), "● gpt-5.6-sol");
});
