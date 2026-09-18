import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import responseTimeExtension, { formatDuration } from "../agent/extensions/response-time.ts";

function harness(t, mode = "tui") {
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const handlers = new Map(), entries = [];
	let renderer;
	responseTimeExtension({
		on: (name, handler) => handlers.set(name, handler),
		registerEntryRenderer: (name, render) => { assert.equal(name, "response-time"); renderer = render; },
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
	});
	const ctx = { mode, isIdle: () => true };
	return {
		entries, ctx,
		time: (value) => { now = value; },
		emit: (name, event = {}) => handlers.get(name)?.(event, ctx),
		end: (stopReason) => handlers.get("agent_end")({ messages: [{ role: "assistant", stopReason }] }, ctx),
		render: (entry, width = 80) => renderer(entry, { expanded: false }, { fg: (_color, text) => text }).render(width),
	};
}

test("formats seconds, minutes, and hours without overflowing units", () => {
	for (const [ms, text] of [[0, "0s"], [59999, "59s"], [60000, "1m 0s"], [102000, "1m 42s"], [3601000, "1h 0m 1s"]]) {
		assert.equal(formatDuration(ms), text);
	}
});

test("records one durable entry only after settling, including retry and tool time", (t) => {
	const h = harness(t);
	h.emit("before_agent_start");
	h.time(1000);
	h.emit("turn_end");
	h.end("error");
	assert.equal(h.entries.length, 0);
	h.time(2000);
	h.emit("before_agent_start");
	h.end("stop");
	h.time(102000);
	h.emit("agent_settled");
	h.emit("agent_settled");
	assert.deepEqual(h.entries, [{ type: "custom", customType: "response-time", data: { elapsedMs: 102000, outcome: "completed" } }]);
	assert.deepEqual(h.render(JSON.parse(JSON.stringify(h.entries[0]))), [" Elapsed: 1m 42s"]);
	h.emit("before_agent_start");
	h.time(105000);
	h.end("stop");
	h.emit("agent_settled");
	assert.equal(h.entries[1].data.elapsedMs, 3000);
});

test("labels interruptions, failures, and output limits and fits narrow terminals", (t) => {
	const h = harness(t);
	for (const [reason, label] of [["aborted", "Interrupted after"], ["error", "Failed after"], ["length", "Output limit reached after"]]) {
		h.time(0);
		h.emit("before_agent_start");
		h.time(5000);
		h.end(reason);
		h.emit("agent_settled");
		assert.deepEqual(h.render(h.entries.at(-1)), [` ${label} 5s`]);
		assert.ok(h.render(h.entries.at(-1), 10).every((line) => visibleWidth(line) <= 10));
	}
});

test("does not finish while another extension continues, or leak across shutdown", (t) => {
	const h = harness(t);
	h.emit("agent_settled");
	h.emit("before_agent_start");
	h.ctx.isIdle = () => false;
	h.emit("agent_settled");
	assert.equal(h.entries.length, 0);
	h.emit("session_shutdown");
	h.ctx.isIdle = () => true;
	h.emit("agent_settled");
	assert.equal(h.entries.length, 0);
});

test("does not add timing entries in non-TUI modes", (t) => {
	const h = harness(t);
	for (const mode of ["print", "json", "rpc"]) {
		h.ctx.mode = mode;
		h.emit("before_agent_start");
		h.end("stop");
		h.emit("agent_settled");
	}
	assert.deepEqual(h.entries, []);
});
