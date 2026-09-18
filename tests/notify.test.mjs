import assert from "node:assert/strict";
import test from "node:test";
import net from "node:net";
import notifyExtension from "../agent/extensions/notify.ts";
import { shortText, contentText, selectHerdrTty, messagePreview, taskTitle } from "../agent/extensions/notify/support.ts";

delete process.env.HERDR_ENV;

test("summaries exclude thinking blocks and control characters and preserve Unicode", () => {
	assert.equal(shortText("<thinking>private</thinking>\n**Done** [tests](url)\x1b;"), "Done tests ;");
	assert.equal(shortText("😀😀😀😀", 3), "😀😀…");
	assert.equal(contentText([{ type: "thinking", thinking: "private" }, { type: "text", text: "result" }]), "result");
});

test("titles prefer session names, then message previews, then project names", () => {
	assert.equal(taskTitle("Manual name", "First request", "/tmp/project"), "Manual name");
	assert.equal(taskTitle(undefined, "First request", "/tmp/project"), "First request");
	assert.equal(taskTitle(undefined, "", "/tmp/project"), "project 会话");
	assert.equal(messagePreview("/var/tmp/pi-clipboard.png 优化通知"), "优化通知");
	assert.equal(messagePreview("@./image.JPG"), "");
	assert.equal(messagePreview([{ type: "image", data: "image" }]), "");
	assert.equal(messagePreview("a".repeat(80)).length, 40);
});

test("session restore, rename, and tree navigation use session data without model calls", async () => {
	const socketPath = `/tmp/pi-notify-test-${process.pid}.sock`;
	const requests = [];
	const server = net.createServer((socket) => {
		let buffer = "";
		socket.on("data", (data) => {
			buffer += data;
			if (buffer.includes("\n")) {
				requests.push(JSON.parse(buffer).params);
				socket.end('{"result":{}}\n');
			}
		});
	});
	await new Promise((resolve) => server.listen(socketPath, resolve));
	const old = { ...process.env };
	process.env.HERDR_ENV = "1";
	process.env.HERDR_SOCKET_PATH = socketPath;
	process.env.HERDR_PANE_ID = "test-pane";
	try {
		const handlers = new Map();
		let name;
		let branch = [
			{ type: "custom", customType: "notification-task", data: { title: "Obsolete generated title" } },
			{ type: "message", message: { role: "user", content: "/tmp/image.png" } },
			{ type: "message", message: { role: "user", content: "First useful request" } },
		];
		notifyExtension({ on: (key, handler) => handlers.set(key, handler), registerCommand() {}, getSessionName: () => name });
		const ctx = { mode: "tui", cwd: "/tmp/project", isIdle: () => true,
			sessionManager: { getBranch: () => branch },
			get modelRegistry() { throw new Error("Must not use model registry"); } };
		handlers.get("session_start")({}, ctx);
		handlers.get("before_agent_start")({ prompt: "Later request" }, ctx);
		name = "Manual name";
		handlers.get("session_info_changed")({}, ctx);
		name = undefined;
		branch = [];
		handlers.get("session_tree")({}, ctx);
		handlers.get("before_agent_start")({ prompt: "New first request" }, ctx);
		ctx.mode = "rpc";
		handlers.get("before_agent_start")({ prompt: "Ignored" }, ctx);
		ctx.mode = "tui";
		await handlers.get("session_shutdown")({}, ctx);
		assert.deepEqual(requests.map((request) => request.tokens.task), [
			"First useful request", "First useful request", "Manual name", "project 会话", "New first request", null,
		]);
	} finally {
		for (const key of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID"]) {
			if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
		}
		await new Promise((resolve) => server.close(resolve));
	}
});

test("desktop notifications keep a fixed Pi Agent title and put status in the body", async (t) => {
	for (const key of ["HERDR_ENV", "WT_SESSION", "KITTY_WINDOW_ID"]) {
		const value = process.env[key];
		delete process.env[key];
		t.after(() => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
	}
	const output = [];
	const originalWrite = process.stdout.write.bind(process.stdout);
	t.mock.method(process.stdout, "write", (text, ...args) => {
		if (typeof text === "string" && text.startsWith("\x1b]777;notify;")) {
			output.push(text);
			return true;
		}
		return originalWrite(text, ...args);
	});
	const handlers = new Map();
	const commands = new Map();
	notifyExtension({ on: (key, handler) => handlers.set(key, handler),
		registerCommand: (key, command) => commands.set(key, command), getSessionName: () => "Changing task title" });
	const ctx = { mode: "tui", cwd: "/tmp/project", isIdle: () => true, ui: { notify() {} } };
	handlers.get("ui_prompt_start")({ title: "Approve command?" }, ctx);
	handlers.get("agent_start")();
	handlers.get("agent_end")({ messages: [{ role: "assistant", content: "Finished tests", stopReason: "stop" }] });
	handlers.get("agent_settled")({}, ctx);
	handlers.get("agent_end")({ messages: [{ role: "assistant", stopReason: "error", errorMessage: "Request failed" }] });
	handlers.get("agent_settled")({}, ctx);
	handlers.get("session_compact_failed")({ errorMessage: "Too large" }, ctx);
	await commands.get("notify-test").handler("", ctx);
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(output, [
		"待确认 · Approve command?", "已完成 · Finished tests", "出错 · Request failed",
		"压缩失败 · Too large", "Desktop notifications are working",
	].map((body) => `\x1b]777;notify;Pi Agent;${body}\x07`));

	output.length = 0;
	for (const stopReason of ["stop", "aborted", "length", "error"]) {
		handlers.get("agent_start")();
		handlers.get("agent_end")({ messages: [{ role: "assistant", content: "长文本😀\n".repeat(80), stopReason, errorMessage: "失败😀".repeat(80) }] });
		handlers.get("agent_settled")({}, ctx);
	}
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(output.length, 4);
	for (const [index, message] of output.entries()) {
		const body = message.slice("\x1b]777;notify;Pi Agent;".length, -1);
		assert.equal(Array.from(body).length, 60);
		assert.ok(body.startsWith(["已完成 · ", "已中止 · ", "输出已达上限 · ", "出错 · "][index]));
		assert.ok(body.endsWith("…"));
		assert.doesNotMatch(body, /[\r\n\uFFFD]/);
	}
});

test("WezTerm routing requires exactly one verified Herdr terminal", () => {
	const panes = [{ tty_name: "/dev/ttys000" }, { tty_name: "/dev/ttys001" }];
	assert.equal(selectHerdrTty(panes, "ttys000 herdr\n?? herdr"), "/dev/ttys000");
	assert.equal(selectHerdrTty(panes, "ttys000 /Users/iu/.local/bin/herdr\nttys001 herdr"), undefined);
	assert.equal(selectHerdrTty(panes, "ttys002 herdr"), undefined);
	assert.equal(selectHerdrTty(panes, "ttys000 not-herdr"), undefined);
});
