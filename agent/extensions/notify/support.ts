import net from "node:net";
import { basename } from "node:path";
import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function selectHerdrTty(panes: { tty_name?: string }[], processes: string): string | undefined {
	const terminals = new Set(processes.split("\n").flatMap((line) => {
		const match = line.trim().match(/^(\S+)\s+(?:\S*\/)?herdr(?:\s|$)/);
		return match && match[1] !== "??" ? [`/dev/${match[1]}`] : [];
	}));
	const matches = [...new Set(panes.map((pane) => pane.tty_name)
		.filter((tty): tty is string => !!tty && /^\/dev\/ttys\d+$/.test(tty) && terminals.has(tty)))];
	return matches.length === 1 ? matches[0] : undefined;
}

export async function notifyWezTerm(title: string, body: string): Promise<boolean> {
	if (process.platform !== "darwin" || process.env.HERDR_ENV !== "1" || process.env.TERM_PROGRAM !== "WezTerm") return false;
	try {
		// Persistent Herdr servers can retain a previous GUI's socket and pane ID.
		const env = { ...process.env };
		delete env.WEZTERM_UNIX_SOCKET;
		const executable = process.env.WEZTERM_EXECUTABLE_DIR
			? `${process.env.WEZTERM_EXECUTABLE_DIR}/wezterm` : "wezterm";
		const [panes, processes] = await Promise.all([
			exec(executable, ["cli", "--no-auto-start", "list", "--format", "json"], { env, timeout: 2000 }),
			exec("ps", ["-axo", "tty=,comm="], { timeout: 2000 }),
		]);
		const tty = selectHerdrTty(JSON.parse(panes.stdout), processes.stdout);
		if (!tty) return false;
		const file = await open(tty, "w");
		try { await file.writeFile(`\x1b]777;notify;${title};${body}\x07`); }
		finally { await file.close(); }
		return true;
	} catch { return false; }
}

export function shortText(value: string, limit = 80): string {
	const text = value.replace(/<thinking>[\s\S]*?<\/thinking>/g, "")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/[`*#]/g, "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim();
	const chars = Array.from(text);
	return chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : text;
}

export function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.filter((part) => part?.type === "text" && typeof part.text === "string")
		.map((part) => part.text).join("\n");
}

export function taskTitle(name: string | undefined, preview: string, cwd: string): string {
	return shortText(name || preview || `${basename(cwd)} 会话`, 40);
}

export function messagePreview(content: unknown): string {
	// Image attachments carry no useful title text; omit pasted image paths too.
	return shortText(contentText(content).replace(/(?:^|\s)@?(?:\/?[^\s]+\.(?:png|jpe?g|gif|webp|bmp))(?=\s|$)/gi, " "), 40);
}

export function reportMetadata(params: Record<string, unknown>): Promise<void> {
	const path = process.env.HERDR_SOCKET_PATH;
	const pane = process.env.HERDR_PANE_ID;
	if (process.env.HERDR_ENV !== "1" || !path || !pane) return Promise.resolve();
	return new Promise((resolve) => {
		const socket = net.createConnection(process.platform === "win32" ? `\\\\.\\pipe\\${path}` : path);
		let buffer = "";
		const finish = () => { socket.destroy(); resolve(); };
		socket.setTimeout(800, finish);
		socket.on("error", finish);
		socket.on("end", finish);
		socket.on("data", (data) => { buffer += data; if (buffer.includes("\n")) finish(); });
		socket.on("connect", () => socket.write(JSON.stringify({
			id: "pi-task-display", method: "pane.report_metadata",
			params: { pane_id: pane, source: "user:pi-task", agent: "pi", applies_to_source: "herdr:pi", ...params },
		}) + "\n"));
	});
}
