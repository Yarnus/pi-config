/**
 * Desktop notifications for Pi.
 *
 * Notifies when Pi is waiting for user input and when an agent run settles.
 * Uses terminal notification protocols supported by WezTerm, Ghostty, iTerm2,
 * Kitty, and Windows Terminal.
 */

import { execFile } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TITLE = "Pi";

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

function notify(title: string, body: string): void {
	const safeTitle = sanitize(title);
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

	// OSC 777 is supported by WezTerm, Ghostty, iTerm2, and rxvt-unicode.
	process.stdout.write(`\x1b]777;notify;${safeTitle};${safeBody}\x07`);
}

export default function notifyExtension(pi: ExtensionAPI) {
	let finalError: string | undefined;

	pi.on("agent_start", () => {
		finalError = undefined;
	});

	pi.on("agent_end", (event) => {
		const lastAssistant = event.messages.findLast((message) => message.role === "assistant");
		if (lastAssistant?.stopReason === "error") {
			finalError = lastAssistant.errorMessage || "Agent stopped with an error";
		}
	});

	// Includes extension questions and confirmation/permission prompts.
	pi.on("ui_prompt_start", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		notify(TITLE, event.title ? `Waiting for input: ${event.title}` : "Waiting for your input");
	});

	// agent_settled runs only after retries, compaction, and queued follow-ups end.
	pi.on("agent_settled", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		notify(TITLE, finalError ? `Error: ${finalError}` : "Task complete — ready for input");
	});

	pi.on("session_compact_failed", (event, ctx) => {
		if (ctx.mode !== "tui" || event.aborted) return;
		notify(TITLE, `Compaction failed: ${event.errorMessage || "unknown error"}`);
	});

	pi.registerCommand("notify-test", {
		description: "Send a test desktop notification",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/notify-test requires TUI mode", "error");
				return;
			}
			notify(TITLE, "Desktop notifications are working");
			ctx.ui.notify("Test notification sent", "info");
		},
	});
}
