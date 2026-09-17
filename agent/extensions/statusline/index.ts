import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type StatusColor =
	| "branch"
	| "cache"
	| "context"
	| "contextDanger"
	| "contextWarning"
	| "input"
	| "model"
	| "output"
	| "path"
	| "separator"
	| "thinking";
type Paint = (color: StatusColor, text: string) => string;

const themeColors = {
	branch: "muted",
	cache: "muted",
	context: "muted",
	contextDanger: "error",
	contextWarning: "warning",
	input: "muted",
	model: "accent",
	output: "muted",
	path: "muted",
	separator: "dim",
	thinking: "warning",
} as const;

interface StatusSnapshot {
	cwd: string;
	branch: string | null;
	provider: string | null;
	model: string;
	thinkingLevel: string | null;
	totalInput: number;
	totalOutput: number;
	cacheRead: number | null;
	cacheWrite: number | null;
	contextTokens: number | null;
	contextWindow: number | null;
	contextPercent: number | null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTokens(value: number | null): string {
	if (value === null) return "?";
	if (value < 1000) return String(Math.round(value));
	if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1000000) return `${Math.round(value / 1000)}k`;
	if (value < 10000000) return `${(value / 1000000).toFixed(1)}M`;
	return `${Math.round(value / 1000000)}M`;
}

function formatCwd(value: string): string {
	if (!value) return "?";
	const home = homedir();
	const relativeToHome = relative(resolve(home), resolve(value));
	const insideHome =
		relativeToHome === "" ||
		(relativeToHome !== ".." &&
			!relativeToHome.startsWith(`..${sep}`) &&
			!isAbsolute(relativeToHome));
	return insideHome ? (relativeToHome === "" ? "~" : `~${sep}${relativeToHome}`) : value;
}

function buildSnapshot(ctx: any, branch: string | null, thinkingLevel: string | null): StatusSnapshot {
	let totalInput = 0;
	let totalOutput = 0;
	let latestUsage: AssistantMessage["usage"] | null = null;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message") continue;
		if (entry.message.role !== "assistant") continue;
		const message = entry.message as AssistantMessage;
		if (message.stopReason === "aborted" || message.stopReason === "error") continue;
		latestUsage = message.usage;
		totalInput += finiteNumber(message.usage.input) ?? 0;
		totalOutput += finiteNumber(message.usage.output) ?? 0;
	}

	const cacheRead = finiteNumber(latestUsage?.cacheRead);
	const cacheWrite = finiteNumber(latestUsage?.cacheWrite);
	const contextUsage = ctx.getContextUsage?.();
	const contextTokens = finiteNumber(contextUsage?.tokens);
	const contextWindow =
		finiteNumber(contextUsage?.contextWindow) ?? finiteNumber(ctx.model?.contextWindow);
	const contextPercent = finiteNumber(contextUsage?.percent);

	return {
		cwd: ctx.cwd,
		branch,
		provider: typeof ctx.model?.provider === "string" ? ctx.model.provider : null,
		model: typeof ctx.model?.id === "string" ? ctx.model.id : "no-model",
		thinkingLevel,
		totalInput,
		totalOutput,
		cacheRead,
		cacheWrite,
		contextTokens,
		contextWindow,
		contextPercent,
	};
}

function join(parts: Array<string | null>, separator: string): string {
	return parts.filter((part): part is string => Boolean(part)).join(separator);
}

function alignSides(left: string, right: string, width: number): string {
	if (!right) return truncateToWidth(left, width, "");
	const gap = width - visibleWidth(left) - visibleWidth(right);
	if (gap >= 2) return `${left}${" ".repeat(gap)}${right}`;

	const rightWidth = visibleWidth(right);
	if (rightWidth <= width - 6) {
		const leftWidth = Math.max(1, width - rightWidth - 2);
		return `${truncateToWidth(left, leftWidth, "")}${" ".repeat(2)}${right}`;
	}
	return truncateToWidth(`${left}  ${right}`, width, "");
}

export function renderStatusLines(
	snapshot: StatusSnapshot,
	width: number,
	paint: Paint = (_color, text) => text,
): string[] {
	const separator = paint("separator", "  ·  ");
	const location = paint("path", `󰉋 ${formatCwd(snapshot.cwd)}`);
	const branch = snapshot.branch ? paint("branch", ` ${snapshot.branch}`) : null;
	const model = join([
		paint("model", `󰚩 ${snapshot.model}`),
		snapshot.provider ? paint("separator", snapshot.provider) : null,
	], " ");
	const thinking = snapshot.thinkingLevel
		? paint("thinking", ` ${snapshot.thinkingLevel}`)
		: null;

	const io = `${paint("input", `↑ ${formatTokens(snapshot.totalInput)}`)}  ${paint("output", `↓ ${formatTokens(snapshot.totalOutput)}`)}`;
	const promptTokens =
		(snapshot.cacheRead ?? 0) + (snapshot.cacheWrite ?? 0) +
		(snapshot.contextTokens !== null
			? Math.max(0, snapshot.contextTokens - (snapshot.cacheRead ?? 0) - (snapshot.cacheWrite ?? 0))
			: 0);
	const cacheHit =
		snapshot.cacheRead !== null && promptTokens > 0
			? ` (${((snapshot.cacheRead / promptTokens) * 100).toFixed(1)}%)`
			: "";
	const cache = snapshot.cacheRead !== null
		? paint(
				"cache",
				`cache ${formatTokens(snapshot.cacheRead)}${cacheHit}${snapshot.cacheWrite ? `  write ${formatTokens(snapshot.cacheWrite)}` : ""}`,
			)
		: null;
	const contextColor: StatusColor =
		(snapshot.contextPercent ?? 0) >= 90
			? "contextDanger"
			: (snapshot.contextPercent ?? 0) >= 70
				? "contextWarning"
				: "context";
	const contextRatio = join(
		[formatTokens(snapshot.contextTokens), snapshot.contextWindow !== null ? formatTokens(snapshot.contextWindow) : null],
		"/",
	);
	const context = paint(
		contextColor,
		`ctx ${contextRatio}${snapshot.contextPercent !== null ? ` (${Math.round(snapshot.contextPercent)}%)` : ""}`,
	);

	if (width >= 110) {
		return [
			alignSides(join([location, branch], separator), join([model, thinking], separator), width),
			alignSides(join([io, cache], separator), context, width),
		];
	}

	if (width >= 78) {
		return [
			alignSides(join([location, branch], separator), join([model, thinking], separator), width),
			alignSides(io, context, width),
		];
	}

	return [
		alignSides(location, model, width),
		alignSides(io, context, width),
	];
}

export default function statuslineExtension(pi: ExtensionAPI) {
	let requestRender: (() => void) | null = null;

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(requestRender);
			return {
				dispose() {
					unsubscribe();
					requestRender = null;
				},
				invalidate() {},
				render(width: number) {
					const snapshot = buildSnapshot(ctx, footerData.getGitBranch(), pi.getThinkingLevel());
					return renderStatusLines(snapshot, width, (color, text) =>
						theme.fg(themeColors[color], text),
					);
				},
			};
		});
	});

	pi.on("turn_end", () => requestRender?.());
	pi.on("model_select", () => requestRender?.());
	pi.on("thinking_level_select", () => requestRender?.());
	pi.on("session_compact", () => requestRender?.());
	pi.on("session_tree", () => requestRender?.());

	pi.on("session_shutdown", (_event, ctx) => {
		requestRender = null;
		ctx.ui.setFooter(undefined);
	});
}
