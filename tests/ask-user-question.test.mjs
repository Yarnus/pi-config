import assert from "node:assert/strict";
import test from "node:test";
import ask from "../agent/extensions/ask-user-question.ts";

let tool;
ask({ registerTool: (value) => { tool = value; } });
const question = "Which path?";
const options = [{ label: "First", value: "first" }, { label: "Second" }];
function execute(params, ctx, signal) { return tool.execute("id", { question, ...params }, signal, undefined, ctx); }

test("ask-user-question reports unavailable choices in RPC without invoking custom UI", async () => {
	const ctx = { mode: "rpc", hasUI: true, ui: { custom() { assert.fail("RPC cannot render custom UI"); } } };
	for (const multiSelect of [false, true]) {
		const result = await execute({ options, multiSelect }, ctx);
		assert.equal(result.details.status, "unavailable");
		assert.match(result.content[0].text, /without options/);
	}
});

test("ask-user-question retains RPC and TUI free-text answers, empty answers, and explicit cancellation", async () => {
	for (const mode of ["rpc", "tui"]) {
		for (const answer of [" typed answer ", "", undefined]) {
			const result = await execute({}, { mode, hasUI: true, ui: { editor: async () => answer } });
			assert.equal(result.details.status, answer === undefined ? "cancelled" : "answered");
			if (answer !== undefined) assert.equal(result.details.answers[0].value, answer.trim());
		}
	}
});

test("ask-user-question leaves headless unavailable and abort cancelled", async () => {
	const ctx = { mode: "print", hasUI: false };
	assert.equal((await execute({}, ctx)).details.status, "unavailable");
	assert.equal((await execute({}, ctx, AbortSignal.abort())).details.status, "cancelled");
});

test("ask-user-question TUI choice keyboard paths select, submit, and cancel", async () => {
	for (const [multiSelect, keys, status] of [
		[false, ["\r"], "answered"],
		[true, [" ", "\x1b[B", "\x1b[B", "\x1b[B", "\r"], "answered"],
		[false, ["\x1b"], "cancelled"],
	]) {
		const ctx = { mode: "tui", hasUI: true, ui: { custom: (factory) => new Promise((resolve) => {
			const component = factory({ requestRender() {} }, { fg: (_color, text) => text }, {}, resolve);
			for (const key of keys) component.handleInput(key);
		}) } };
		const result = await execute({ options, multiSelect }, ctx);
		assert.equal(result.details.status, status);
		if (status === "answered") assert.equal(result.details.answers[0].value, "first");
	}
});
