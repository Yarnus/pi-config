import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const core = join(execFileSync("npm", ["root", "--global"], { encoding: "utf8" }).trim(), "@earendil-works/pi-coding-agent/dist");
const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(join(core, "core/extensions/loader.js")));
const originalTools = ["read", "bash", "edit", "write", "ask_user_question", "web_search", "fetch_content", "get_search_content", "subagent", "todo", "interactive_shell", "unknown_tool"];

async function harness({ mode = "tui", branch = [], tools = originalTools, previousEditor } = {}) {
	let activeTools = [...tools], editorFactory = previousEditor, idle = true;
	const statuses = new Map(), widgets = new Map(), notices = [], calls = [];
	const runtime = createExtensionRuntime();
	runtime.getActiveTools = () => [...activeTools];
	runtime.setActiveTools = (tools) => { activeTools = [...tools]; calls.push([...tools]); };
	runtime.appendEntry = (customType, data) => branch.push({ type: "custom", customType, data: structuredClone(data) });
	const { extensions, errors } = await loadExtensions([resolve("agent/extensions/plan-mode.ts")], process.cwd(), undefined, runtime);
	assert.deepEqual(errors, []);
	const extension = extensions[0];
	const ctx = {
		mode, hasUI: ["tui", "rpc"].includes(mode), isIdle: () => idle,
		sessionManager: { getBranch: () => branch },
		ui: {
			setStatus: (key, text) => statuses.set(key, text),
			setWidget: (key, lines) => widgets.set(key, lines),
			notify: (text) => notices.push(text),
			getEditorComponent: () => editorFactory,
			setEditorComponent: (factory) => { editorFactory = factory; },
		},
	};
	const emit = async (name, event = {}) => {
		const handlers = extension.handlers.get(name) ?? [];
		assert.equal(handlers.length, 1, name);
		return handlers[0](event, ctx);
	};
	await emit("session_start");
	return {
		emit, ctx, branch, calls, notices, statuses, widgets,
		get tools() { return activeTools; },
		get factory() { return editorFactory; },
		setIdle(value) { idle = value; },
		setTools(value) { activeTools = [...value]; },
		toggle: () => extension.commands.get("plan").handler("", ctx),
		tool: (toolName, input = {}) => emit("tool_call", { toolName, input }),
	};
}

function fakeEditor() {
	let text = "";
	const received = [];
	return { received, getText: () => text, setText: (value) => { text = value; }, handleInput: (data) => received.push(data) };
}

for (const key of ["\t", "\x1b[9u"]) {
	test(`plan-mode empty editor toggles on Tab ${JSON.stringify(key)} without forwarding it`, async () => {
		const base = fakeEditor();
		const h = await harness({ previousEditor: () => base });
		const editor = h.factory({}, {}, {});
		assert.equal(editor, base, "wrap existing editor instead of replacing its behavior");
		editor.handleInput(key);
		assert.equal(h.statuses.get("local-plan-mode"), "Plan");
		assert.match(h.widgets.get("local-plan-mode")[0], /Plan/);
		assert.deepEqual(h.tools, originalTools.filter((name) => ["read", "bash", "ask_user_question", "web_search", "fetch_content", "get_search_content"].includes(name)));
		editor.handleInput(key);
		assert.equal(h.statuses.get("local-plan-mode"), "Build");
		assert.equal(h.widgets.get("local-plan-mode"), undefined);
		assert.deepEqual(h.tools, originalTools);
		assert.deepEqual(base.received, []);
	});
}

test("plan-mode passes nonempty Tab unchanged, including whitespace and multiline text", async () => {
	const base = fakeEditor();
	const h = await harness({ previousEditor: () => base });
	const editor = h.factory({}, {}, {});
	for (const text of [" ", "\t", "\n", "\n\n", "src/", "@", "中文", "first\n"]) {
		base.setText(text);
		editor.handleInput("\t");
		assert.equal(base.getText(), text);
	}
	assert.deepEqual(base.received, Array(8).fill("\t"));
	assert.equal(h.branch.length, 0);
	base.setText("");
	for (const key of ["@", "\x1b[Z", "a", "\x1b", "\x1b[9;2u"]) editor.handleInput(key);
	assert.deepEqual(base.received.slice(8), ["@", "\x1b[Z", "a", "\x1b", "\x1b[9;2u"]);
	assert.equal(h.branch.length, 0);
});

test("plan-mode never treats bracketed paste Tab as mode switching", async () => {
	const base = fakeEditor();
	const h = await harness({ previousEditor: () => base });
	const editor = h.factory({}, {}, {});
	const chunks = ["\x1b[200~", "\t", "\x1b[201~", "\x1b[200~\t\x1b[201~"];
	for (const chunk of chunks) editor.handleInput(chunk);
	assert.deepEqual(base.received, chunks);
	assert.equal(h.branch.length, 0);
	editor.handleInput("\t");
	assert.equal(h.branch.length, 1);
});

test("plan-mode uses real CustomEditor completion and leaves Shift+Tab/app handling intact", async () => {
	const h = await harness();
	const editor = h.factory({ requestRender() {}, terminal: { rows: 30, columns: 100 } }, { borderColor: (s) => s, selectList: {} }, { matches: () => false });
	let completions = 0, appKeys = 0;
	editor.setAutocompleteProvider({
		getSuggestions: async () => { completions++; return null; },
		applyCompletion() { assert.fail("no suggestions"); },
		shouldTriggerFileCompletion: () => true,
	});
	editor.onExtensionShortcut = (data) => { if (data === "\x1b[Z") { appKeys++; return true; } return false; };
	editor.handleInput("\t");
	assert.equal(completions, 0);
	editor.setText("src/");
	editor.handleInput("\t");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(completions, 1);
	editor.setText("");
	editor.handleInput("\x1b[Z");
	assert.equal(appKeys, 1);
	assert.equal(h.branch.length, 1);
});

test("plan-mode rejects toggles while busy; neither queues nor changes tool state", async () => {
	const base = fakeEditor();
	const h = await harness({ previousEditor: () => base });
	const editor = h.factory({}, {}, {});
	h.setIdle(false);
	editor.handleInput("\t");
	await h.toggle();
	assert.equal(h.branch.length, 0);
	assert.deepEqual(h.tools, originalTools);
	assert.equal(h.notices.length, 2);
	h.setIdle(true);
	await h.toggle();
	h.setIdle(false);
	await h.toggle();
	assert.equal(h.branch.length, 1);
	assert.equal(h.statuses.get("local-plan-mode"), "Plan");
	h.setIdle(true);
	assert.equal(h.statuses.get("local-plan-mode"), "Plan");
});

test("plan-mode denies mutation, delegation, unknown and newly enabled tools at execution time", async () => {
	const h = await harness();
	await h.toggle();
	for (const name of ["edit", "write", "subagent", "todo", "interactive_shell", "unknown_tool", "powershell", "grep"]) {
		assert.equal((await h.tool(name)).block, true, name);
	}
	for (const name of ["read", "ask_user_question", "web_search", "fetch_content", "get_search_content"]) assert.equal(await h.tool(name), undefined, name);
	h.setTools([...h.tools, "edit", "new_tool"]);
	const plan = await h.emit("before_agent_start", { systemPrompt: "original prompt" });
	assert.match(plan.systemPrompt, /^original prompt\n\n\[PLAN MODE\]/);
	assert.ok(!h.tools.includes("edit"));
	assert.equal((await h.tool("new_tool")).block, true);
	assert.equal((await h.emit("user_bash", { command: "touch file" })).result.exitCode, 1);
	await h.toggle();
	assert.deepEqual(h.tools, originalTools, "restore exact snapshot, not defaults or additions");
	assert.equal(await h.tool("write"), undefined);
	assert.equal(await h.emit("before_agent_start", { systemPrompt: "base" }), undefined);
	assert.equal(await h.emit("user_bash"), undefined);
});

test("plan-mode shell permits useful literal inspection, search, and constrained Git queries", async () => {
	const h = await harness();
	await h.toggle();
	for (const command of ["cat README.md", "head -n 20 'file with spaces'", "tail -c 30 file", "wc -l file", "ls -al", "pwd", "rg -n 'some words' src", "rg -g '*.ts' --hidden needle .", "rg --files", "grep -rn foo src", "rg -A 3 foo .", "git status --short", "git log --oneline -10", "cat  README.md", "rg -- '--pre' file"]) {
		const input = { command };
		assert.equal(await h.tool("bash", input), undefined, command);
		if (command.startsWith("rg")) assert.match(input.command, /^rg --no-config /);
		if (command.startsWith("git status")) assert.match(input.command, /^GIT_OPTIONAL_LOCKS=0 git -c core.fsmonitor=false --no-pager status/);
		if (command.startsWith("git log")) assert.match(input.command, /--no-show-signature --no-ext-diff --no-textconv/);
	}
});

test("plan-mode shell rejects executable options, mutating commands and compound shell syntax", async () => {
	const h = await harness();
	await h.toggle();
	for (const command of [undefined, null, {}, "", " ", "rm file", "cat x; rm x", "cat x\nrm x", "cat $(touch x)", "cat `touch x`", "cat <(touch x)", "cat x > y", "cat x | sh", "cat x && touch y", "cat x &", "cat $FILE", "cat \\x", "cat *", "cat ~", "cat 'bad", "c'at' file", "cat x\u0000", "find . -exec sh x ;", "awk 'system(1)'", "sed -n 'w file'", "curl url", "env sh x", "rg --pre=sh x", "rg --pre sh x", "rg --hostname-bin=sh x", "rg --pcre2 foo", "rg -A nope foo", "rg -g", "grep --devices=read x", "ls --some-new-option", "tail -f file", "head -n oops file", "git diff --output=file", "git log --output=file", "git log --ext-diff", "git log --show-signature", "git status --config=evil", "git -c core.pager=evil log", "git branch new", "npm test"]) {
		assert.equal((await h.tool("bash", { command })).block, true, JSON.stringify(command));
	}
});

test("plan-mode persists and restores branch state across reload/resume/tree, then cleans up", async () => {
	const previousEditor = () => fakeEditor();
	const first = await harness({ previousEditor });
	await first.toggle();
	const planBranch = structuredClone(first.branch);
	await first.emit("session_shutdown");
	assert.deepEqual(first.tools, originalTools);
	assert.equal(first.factory, previousEditor);
	assert.equal(first.statuses.get("local-plan-mode"), undefined);
	assert.equal(first.widgets.get("local-plan-mode"), undefined);
	const resumed = await harness({ branch: structuredClone(planBranch) });
	assert.equal(resumed.statuses.get("local-plan-mode"), "Plan");
	assert.ok(!resumed.tools.includes("write"));
	await resumed.toggle();
	assert.deepEqual(resumed.tools, originalTools);
	resumed.branch.splice(0, resumed.branch.length, ...planBranch);
	await resumed.emit("session_tree");
	assert.equal(resumed.statuses.get("local-plan-mode"), "Plan");
	resumed.branch.length = 0;
	await resumed.emit("session_tree");
	assert.equal(resumed.statuses.get("local-plan-mode"), "Build");
	assert.deepEqual(resumed.tools, originalTools);
});

test("plan-mode never enables tools absent before entry, including empty tool lists", async () => {
	for (const tools of [[], ["read"], ["read", "grep", "find", "ls", "subagent"]]) {
		const h = await harness({ tools });
		await h.toggle();
		assert.deepEqual(h.tools, tools.filter((name) => name !== "subagent"));
		await h.toggle();
		assert.deepEqual(h.tools, tools);
	}
});

test("plan-mode RPC/headless does not install terminal editor, while command and guards still work", async () => {
	for (const mode of ["rpc", "json", "print"]) {
		const h = await harness({ mode });
		assert.equal(h.factory, undefined);
		await h.toggle();
		assert.equal((await h.tool("write")).block, true);
		await h.emit("session_shutdown");
		assert.deepEqual(h.tools, originalTools);
	}
});
