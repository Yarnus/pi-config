/**
 * Desktop notifications for Pi.
 *
 * Notifies when Pi is waiting for user input and when an agent run settles.
 * Uses terminal notifications when available.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { contentText, shortText } from "./notify/support.ts";

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

function notify(body: string): void {
	const safeTitle = TITLE;
	const safeBody = sanitize(body);

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

	// Other terminals may support OSC 777 as a fallback.
	process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
}

export default function notifyExtension(pi: ExtensionAPI) {
	let finalError: string | undefined;
	let finalText = "";
	let outcome = "已完成";
	pi.on("agent_start", () => {
		finalError = undefined;
		finalText = "";
		outcome = "已完成";
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
		notify(shortText(`待确认 · ${event.title || "需要你的输入才能继续"}`, 220));
	});

	// agent_settled runs only after retries, compaction, and queued follow-ups end.
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		if (!ctx.isIdle()) return;
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
