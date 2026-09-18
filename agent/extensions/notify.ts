/**
 * Desktop notifications for Pi.
 *
 * Notifies when Pi is waiting for user input and when an agent run settles.
 * Publishes task/activity metadata without taking over Herdr lifecycle state.
 * Uses WezTerm notifications when reachable, with a macOS native fallback.
 */

import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { contentText, shortText, reportMetadata, notifyWezTerm, messagePreview, taskTitle } from "./notify/support.ts";

const TITLE = "Pi Agent";
// Approximate two notification body lines; the OS controls actual wrapping.
const RESULT_BODY_LIMIT = 60;

function sanitize(value: string): string {
	// OSC payloads must not contain control characters or protocol separators.
	return value.replace(/[\x00-\x1f\x7f;]/g, " ").trim();
}

function windowsToastScript(title: string, body: string): string {
	const escapePowerShell = (value: string) => value.replaceAll("'", "''");
	const safeTitle = escapePowerShell(title);
	const safeBody = escapePowerShell(body);
	const type = "Windows.UI.Notifications";
	const manager = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
	const template = `[${type}.ToastTemplateType]::ToastText01`;
	const toast = `[${type}.ToastNotification]::new($xml)`;

	return [
		`${manager} > $null`,
		`$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
		`$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${safeBody}')) > $null`,
		`[${type}.ToastNotificationManager]::CreateToastNotifier('${safeTitle}').Show(${toast})`,
	].join("; ");
}

async function notify(body: string): Promise<void> {
	const safeTitle = TITLE;
	const safeBody = sanitize(body);

	if (await notifyWezTerm(safeTitle, safeBody)) return;

	if (process.platform === "darwin" && process.env.HERDR_ENV === "1") {
		// Pass text as argv, never interpolate model output into AppleScript.
		execFile("osascript", ["-e", "on run argv", "-e",
			"display notification (item 2 of argv) with title (item 1 of argv)",
			"-e", "end run", safeTitle, safeBody], { timeout: 5000 }, () => {});
		return;
	}

	if (process.env.WT_SESSION) {
		execFile(
			"powershell.exe",
			["-NoProfile", "-Command", windowsToastScript(safeTitle, safeBody)],
			() => {},
		);
		return;
	}

	if (process.env.KITTY_WINDOW_ID) {
		process.stdout.write(`\x1b]99;i=pi:d=0;${safeTitle}\x1b\\`);
		process.stdout.write(`\x1b]99;i=pi:p=body;${safeBody}\x1b\\`);
		return;
	}

	// OSC 777 is supported by WezTerm, Ghostty, iTerm2, and rxvt-unicode.
	process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
}

export default function notifyExtension(pi: ExtensionAPI) {
	let finalError: string | undefined;
	let finalText = "";
	let outcome = "已完成";
	let task = "";
	let activity = "等待输入";
	let publishing = Promise.resolve();
	const runningTools = new Map<string, string>();
	const title = (ctx: ExtensionContext) => taskTitle(pi.getSessionName(), task, ctx.cwd);
	function publish(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") return;
		const params = { tokens: { task: title(ctx), activity: shortText(activity) }, ttl_ms: 86400000 };
		publishing = publishing.then(() => reportMetadata(params)).catch(() => {});
	}
	function restore(ctx: ExtensionContext) {
		task = "";
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "user") {
				task = messagePreview(entry.message.content);
				if (task) break;
			}
		}
		activity = ctx.isIdle() ? "等待输入" : "处理中";
		publish(ctx);
	}
	pi.on("session_start", (_event, ctx) => { if (ctx.mode === "tui") restore(ctx); });
	pi.on("session_tree", (_event, ctx) => { if (ctx.mode === "tui") restore(ctx); });
	pi.on("session_info_changed", (_event, ctx) => publish(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		await publishing;
		await reportMetadata({ tokens: { task: null, activity: null } });
	});
	pi.on("before_agent_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!task) task = messagePreview(event.prompt);
		activity = "分析请求";
		publish(ctx);
	});
	pi.on("tool_execution_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		const args = event.args as Record<string, unknown>;
		const labels: Record<string, string> = { read: "读取", edit: "修改", write: "写入", bash: "执行命令", web_search: "搜索资料", subagent: "协调子任务", todo: "更新计划", ask_user_question: "等待你的选择" };
		const path = typeof args.path === "string" ? ` ${basename(args.path)}` : "";
		runningTools.set(event.toolCallId, (labels[event.toolName] || event.toolName) + path);
		activity = [...runningTools.values()].at(-1)!;
		publish(ctx);
	});
	pi.on("tool_execution_end", (event, ctx) => {
		runningTools.delete(event.toolCallId);
		activity = [...runningTools.values()].at(-1) || "分析结果";
		publish(ctx);
	});

	pi.on("agent_start", () => {
		finalError = undefined;
		finalText = "";
		outcome = "已完成";
		runningTools.clear();
	});

	pi.on("agent_end", (event) => {
		const lastAssistant = event.messages.findLast((message) => message.role === "assistant");
		finalText = shortText(contentText(lastAssistant?.content), 220);
		outcome = lastAssistant?.stopReason === "aborted" ? "已中止" : lastAssistant?.stopReason === "length" ? "输出已达上限" : "已完成";
		if (lastAssistant?.stopReason === "error") {
			finalError = lastAssistant.errorMessage || "Agent stopped with an error";
		}
	});

	// Includes extension questions and confirmation/permission prompts.
	pi.on("ui_prompt_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		activity = event.title ? `等待选择：${event.title}` : "等待你的输入";
		publish(ctx);
		notify(shortText(`待确认 · ${event.title || "需要你的输入才能继续"}`, 220));
	});

	pi.on("ui_prompt_end", (_event, ctx) => {
		activity = [...runningTools.values()].at(-1) || (ctx.isIdle() ? "等待输入" : "处理中");
		publish(ctx);
	});

	// agent_settled runs only after retries, compaction, and queued follow-ups end.
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!ctx.isIdle()) return;
		activity = finalError ? `出错：${finalError}` : `${outcome} · ${finalText || "等待输入"}`;
		publish(ctx);
		notify(shortText(`${finalError ? "出错" : outcome} · ${finalError || finalText || "本轮已结束，等待你的输入"}`, RESULT_BODY_LIMIT));
	});

	pi.on("session_compact_failed", (event, ctx) => {
		if (ctx.mode !== "tui" || event.aborted) return;
		notify(shortText(`压缩失败 · ${event.errorMessage || "未知错误"}`, 220));
	});

	pi.registerCommand("notify-test", {
		description: "Send a test desktop notification",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/notify-test requires TUI mode", "error");
				return;
			}
			notify("Desktop notifications are working");
			ctx.ui.notify("Test notification sent", "info");
		},
	});
}
