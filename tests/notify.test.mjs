import assert from "node:assert/strict";
import test from "node:test";
import notifyExtension from "../agent/extensions/notify.ts";
import { shortText, contentText } from "../agent/extensions/notify/support.ts";

function harness(t, kitty = false) {
	for (const key of ["WT_SESSION", "KITTY_WINDOW_ID"]) {
		const value = process.env[key];
		delete process.env[key];
		t.after(() => { if (value === undefined) delete process.env[key]; else process.env[key] = value; });
	}
	if (kitty) process.env.KITTY_WINDOW_ID = "1";
	const output = [];
	const originalWrite = process.stdout.write.bind(process.stdout);
	t.mock.method(process.stdout, "write", (text, ...args) => {
		if (typeof text === "string" && (text.startsWith("\x1b]777;") || text.startsWith("\x1b]99;"))) {
			output.push(text);
			return true;
		}
		return originalWrite(text, ...args);
	});
	const handlers = new Map();
	const commands = new Map();
	notifyExtension({ on: (key, handler) => handlers.set(key, handler),
		registerCommand: (key, command) => commands.set(key, command) });
	const ctx = { mode: "tui", isIdle: () => true, ui: { notify() {} } };
	return { handlers, commands, ctx, output };
}

function endRun(handlers, stopReason = "stop", content = "Finished tests", errorMessage) {
	handlers.get("agent_start")();
	handlers.get("agent_end")({ messages: [{ role: "assistant", content, stopReason, errorMessage }] });
}

test("summaries exclude thinking blocks and control characters and preserve Unicode", () => {
	assert.equal(shortText("<thinking>private</thinking>\n**Done** [tests](url)\x1b;"), "Done tests ;");
	assert.equal(shortText("😀😀😀😀", 3), "😀😀…");
	assert.equal(contentText([{ type: "thinking", thinking: "private" }, { type: "text", text: "result" }]), "result");
});

test("desktop notifications keep a fixed Pi Agent title and put status in the body", async (t) => {
	const { handlers, commands, ctx, output } = harness(t);
	handlers.get("ui_prompt_start")({ title: "Approve command?" }, ctx);
	endRun(handlers);
	handlers.get("agent_settled")({}, ctx);
	endRun(handlers, "error", "", "Request failed");
	handlers.get("agent_settled")({}, ctx);
	handlers.get("session_compact_failed")({ errorMessage: "Too large" }, ctx);
	await commands.get("notify-test").handler("", ctx);
	assert.deepEqual(output, [
		"待确认 · Approve command?", "已完成 · Finished tests", "出错 · Request failed",
		"压缩失败 · Too large", "Desktop notifications are working",
	].map((body) => `\x1b]777;notify;Pi Agent;${body}\x07`));

	output.length = 0;
	for (const stopReason of ["stop", "aborted", "length", "error"]) {
		endRun(handlers, stopReason, "长文本😀\n".repeat(80), "失败😀".repeat(80));
		handlers.get("agent_settled")({}, ctx);
	}
	assert.equal(output.length, 4);
	for (const [index, message] of output.entries()) {
		const body = message.slice("\x1b]777;notify;Pi Agent;".length, -1);
		assert.equal(Array.from(body).length, 60);
		assert.ok(body.startsWith(["已完成 · ", "已中止 · ", "输出已达上限 · ", "出错 · "][index]));
		assert.ok(body.endsWith("…"));
		assert.doesNotMatch(body, /[\r\n\uFFFD]/);
	}
});

test("Kitty notifications send OSC 99 title and body chunks and sanitize payloads", async (t) => {
	const { handlers, commands, ctx, output } = harness(t, true);
	await commands.get("notify-test").handler("", ctx);
	handlers.get("ui_prompt_start")({ title: "Approve; command?\x1b\x07\n" }, ctx);
	endRun(handlers);
	handlers.get("agent_settled")({}, ctx);
	assert.deepEqual(output, [
		"Desktop notifications are working", "待确认 · Approve  command?", "已完成 · Finished tests",
	].flatMap((body) => [
		"\x1b]99;i=pi:d=0;Pi Agent\x1b\\",
		`\x1b]99;i=pi:p=body;${body}\x1b\\`,
	]));
});

test("notifications wait for settlement and discard transient retry errors", (t) => {
	const { handlers, ctx, output } = harness(t, true);
	endRun(handlers, "error", "", "Transient error");
	assert.deepEqual(output, []);
	endRun(handlers);
	ctx.isIdle = () => false;
	handlers.get("agent_settled")({}, ctx);
	assert.deepEqual(output, []);
	ctx.isIdle = () => true;
	handlers.get("agent_settled")({}, ctx);
	assert.equal(output.length, 2);
	assert.ok(output[1].includes("已完成 · Finished tests"));
	assert.ok(!output[1].includes("Transient error"));
});

test("non-TUI modes and cancelled compaction never emit terminal notifications", async (t) => {
	const { handlers, commands, ctx, output } = harness(t, true);
	for (const mode of ["rpc", "print", "json"]) {
		ctx.mode = mode;
		handlers.get("ui_prompt_start")({ title: "Question" }, ctx);
		endRun(handlers);
		handlers.get("agent_settled")({}, ctx);
		handlers.get("session_compact_failed")({ errorMessage: "Too large" }, ctx);
		await commands.get("notify-test").handler("", ctx);
	}
	ctx.mode = "tui";
	handlers.get("session_compact_failed")({ aborted: true }, ctx);
	assert.deepEqual(output, []);
});
