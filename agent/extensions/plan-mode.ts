/** Small adaptation of Pi's examples/extensions/plan-mode: no plan extraction or TODO ownership. */
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";

const STATE_TYPE = "local-plan-mode";
const PLAN_TOOLS = new Set([
	"read", "grep", "find", "ls", "bash", "ask_user_question",
	"web_search", "fetch_content", "get_search_content",
]);

const SIMPLE_FLAGS: Record<string, RegExp> = {
	cat: /^-[bnsvET]+$/,
	head: /^-(?:n|c)$/,
	tail: /^-(?:n|c)$/,
	wc: /^-[clmwL]+$/,
	ls: /^-[alhRdFi1]+$/,
	pwd: /^-[LP]$/,
	rg: /^(?:-[nilvFwcs]+|--(?:files|hidden|no-ignore|fixed-strings|line-number|ignore-case))$/,
	grep: /^-[nrilvFwcsEH]+$/,
};

/** Deliberately not a shell parser: one command, literal arguments, a small option vocabulary. */
function planBashCommand(command: unknown): string | undefined {
	if (typeof command !== "string" || /[\x00-\x1f\x7f$`\\;|&<>(){}]/.test(command)) return;
	const text = command.trim();
	if (!/^(?:"[^"\n]*"|'[^'\n]*'|[^\s'"]+)(?: +(?:"[^"\n]*"|'[^'\n]*'|[^\s'"]+))*$/.test(text)) return;
	const words = text.match(/"[^"\n]*"|'[^'\n]*'|[^\s'"]+/g)!;
	// Unquoted glob expansion could introduce options from filenames.
	if (words.some((word) => !/^["']/.test(word) && /[*?\[\]~]/.test(word))) return;
	const args = words.map((word) => /^["']/.test(word) ? word.slice(1, -1) : word);
	const [name, ...rest] = args;
	if (name === "git") {
		const [subcommand, ...options] = rest;
		if (subcommand === "status" && options.every((arg) => /^(?:--short|--branch|--porcelain(?:=v[12])?|-sb|-s|-b)$/.test(arg))) {
			return `GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false --no-pager ${words.slice(1).join(" ")}`;
		}
		if (subcommand === "log" && options.every((arg) => /^(?:--oneline|--all|--max-count=\d+|-\d+)$/.test(arg))) {
			return `git --no-pager log --no-show-signature --no-ext-diff --no-textconv ${words.slice(2).join(" ")}`.trim();
		}
		return;
	}
	if (!Object.hasOwn(SIMPLE_FLAGS, name)) return;
	const flags = SIMPLE_FLAGS[name];
	let literal = false;
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (literal) continue;
		if (arg === "--") { literal = true; continue; }
		if (!arg.startsWith("-")) continue;
		if ((name === "head" || name === "tail") && /^-[nc]$/.test(arg)) {
			if (!/^\d+$/.test(rest[++i] ?? "")) return;
		} else if ((name === "rg" || name === "grep") && /^-[ABCm]$/.test(arg)) {
			if (!/^\d+$/.test(rest[++i] ?? "")) return;
		} else if (name === "rg" && (arg === "-g" || arg === "--glob")) {
			if (rest[++i] === undefined) return;
		} else if (!flags.test(arg)) return;
	}
	return name === "rg" ? `rg --no-config ${words.slice(1).join(" ")}`.trim() : words.join(" ");
}

interface PlanState {
	enabled: boolean;
	toolsBeforePlanMode?: string[];
}

export default function planModeExtension(pi: ExtensionAPI): void {
	let enabled = false;
	let toolsBeforePlanMode: string[] | undefined;
	let restoreEditor: (() => void) | undefined;

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(STATE_TYPE, enabled ? "Plan" : "Build");
		// The owned two-line statusline intentionally does not render extension statuses.
		ctx.ui.setWidget(STATE_TYPE, enabled ? ["Plan · Tab on empty input or /plan to return to Build"] : undefined);
	}

	function restoreTools(): void {
		if (toolsBeforePlanMode !== undefined) pi.setActiveTools(toolsBeforePlanMode);
		toolsBeforePlanMode = undefined;
	}

	function restrictTools(): void {
		pi.setActiveTools((toolsBeforePlanMode ?? []).filter((name) => PLAN_TOOLS.has(name)));
	}

	function toggle(ctx: ExtensionContext): void {
		if (!ctx.isIdle()) {
			if (ctx.hasUI) ctx.ui.notify("Wait for the current run to finish (or abort it) before switching Plan / Build.", "warning");
			return;
		}
		enabled = !enabled;
		if (enabled) {
			toolsBeforePlanMode = [...pi.getActiveTools()];
			restrictTools();
		} else {
			restoreTools();
		}
		pi.appendEntry(STATE_TYPE, { enabled, toolsBeforePlanMode } satisfies PlanState);
		updateStatus(ctx);
		if (ctx.hasUI) ctx.ui.notify(enabled ? "Plan mode: explore and discuss; mutation tools disabled." : "Build mode: previous active tools restored.", "info");
	}

	function restoreState(ctx: ExtensionContext): void {
		restoreTools();
		enabled = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE_TYPE) continue;
			const state = entry.data as PlanState | undefined;
			if (typeof state?.enabled !== "boolean") continue;
			enabled = state.enabled;
			toolsBeforePlanMode = Array.isArray(state.toolsBeforePlanMode) && state.toolsBeforePlanMode.every((name) => typeof name === "string")
				? [...state.toolsBeforePlanMode] : undefined;
		}
		if (enabled) {
			toolsBeforePlanMode ??= [...pi.getActiveTools()];
			restrictTools();
		} else {
			toolsBeforePlanMode = undefined;
		}
		updateStatus(ctx);
	}

	pi.registerCommand("plan", {
		description: "Toggle Plan / Build (also Tab when the editor is empty)",
		handler: async (_args, ctx) => toggle(ctx),
	});

	pi.on("session_start", (_event, ctx) => {
		restoreState(ctx);
		if (ctx.mode !== "tui") return;
		const previous = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			const editor = previous?.(tui, theme, keybindings) ?? new CustomEditor(tui, theme, keybindings, { embedWorkingStatus: true });
			const handleInput = editor.handleInput.bind(editor);
			let pasting = false;
			editor.handleInput = (data: string) => {
				if (data.includes("\x1b[200~")) pasting = true;
				if (!pasting && editor.getText() === "" && matchesKey(data, "tab")) {
					toggle(ctx);
					return;
				}
				handleInput(data);
				if (data.includes("\x1b[201~")) pasting = false;
			};
			return editor;
		});
		restoreEditor = () => ctx.ui.setEditorComponent(previous);
	});

	pi.on("session_tree", (_event, ctx) => restoreState(ctx));
	pi.on("session_shutdown", (_event, ctx) => {
		restoreTools();
		restoreEditor?.();
		restoreEditor = undefined;
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATE_TYPE, undefined);
			ctx.ui.setWidget(STATE_TYPE, undefined);
		}
	});

	pi.on("before_agent_start", (event) => {
		if (!enabled) return;
		restrictTools();
		return {
			systemPrompt: `${event.systemPrompt}\n\n[PLAN MODE]\nExplore the code, ask clarifying questions with ask_user_question when available, and propose an implementation-ready plan. Do not implement changes or delegate execution. Only allowlisted exploration tools are available. Bash accepts single literal commands: cat/head/tail/wc/ls/pwd, limited rg/grep, git status/log; no shell composition. Prefer read/search tools. The user must switch to Build before implementation.`,
		};
	});

	pi.on("tool_call", (event) => {
		if (!enabled) return;
		if (!PLAN_TOOLS.has(event.toolName) || !toolsBeforePlanMode?.includes(event.toolName)) {
			return { block: true, reason: `Plan mode blocks ${event.toolName}. Switch to Build before executing changes or delegating work.` };
		}
		if (event.toolName === "bash") {
			const command = planBashCommand(event.input.command);
			if (command === undefined) return { block: true, reason: "Plan mode blocks this shell command. Use a simple allowlisted inspection command or switch to Build." };
			event.input.command = command;
		}
	});

	pi.on("user_bash", () => {
		if (enabled) return { result: { output: "Plan mode blocks ! / !! shell execution. Switch to Build first.", exitCode: 1, cancelled: false, truncated: false } };
	});
}
