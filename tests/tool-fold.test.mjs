import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { installFolding } from "../agent/extensions/tool-fold/support.ts";

function harness(t, theme = { fg: (_, text) => text, bold: (text) => text }) {
 class Tool {
  constructor(name = "bash", args = { command: "echo hello" }) {
   this.toolName = name; this.args = args; this.expanded = false;
   this.isPartial = false; this.executionStarted = true;
   this.result = { content: [{ type: "text", text: "hello\nworld\n" }], durationMs: 100 };
   this.ui = { requestRender() {} };
  }
  render() { return ["native preview"]; }
  setExpanded(value) { this.expanded = value; }
  handleMouse(event) { this.lastMouse = event; return { handled: true }; }
  updateDisplay() { this.argsPending = false; }
 }
 const original = Tool.prototype.render;
 const folding = installFolding({ ToolExecutionComponent: Tool }, () => theme);
 t.after(() => folding.dispose());
 return { Tool, folding, original };
}
test("adds one blank line after user messages without mutating cached lines and restores on dispose", () => {
 const cached = ["user message"];
 class User { render() { return cached; } }
 class Tool { render() { return []; } }
 const original = User.prototype.render;
 const folding = installFolding({ UserMessageComponent: User, ToolExecutionComponent: Tool }, () => ({}));
 try {
  const user = new User();
  assert.deepEqual(user.render(80), ["user message", ""]);
  assert.deepEqual(user.render(80), ["user message", ""]);
  assert.deepEqual(cached, ["user message"]);
 } finally { folding.dispose(); }
 assert.equal(User.prototype.render, original);
});

const click = (tool, y = 0) => tool.handleMouse({ type: "click", button: "left", x: 0, y, width: 100, height: 10 });

test("all calls are flat, independently expandable, and support global expansion", (t) => {
 const { Tool, folding } = harness(t);
 const a = new Tool(), b = new Tool("read", { path: "hello.txt" });
 const draw = () => [...a.render(100), ...b.render(100)];
 assert.equal(draw().length, 2);
 assert.doesNotMatch(draw().join("\n"), /calls|×|▸|▾|✓|✗|│/);
 assert.match(draw()[0], /^ ● bash.*2 lines · 0.1s/);
 click(a);
 assert.deepEqual(a.render(100).slice(1).map((line) => line.trimEnd()), ["    │ hello", "    │ world"]);
 assert.equal(b.render(100).length, 1);
 click(a);
 assert.equal(a.render(100).length, 1);
 draw(); folding.toggle();
 assert.equal(b.expanded, true);
 assert.equal(a.expanded, false);
 for (const tool of [a, b]) tool.setExpanded(true);
 assert.equal(draw().length, 6);
 for (const tool of [a, b]) tool.setExpanded(false);
 assert.equal(draw().length, 2);
});

test("status dots distinguish waiting, running, success and failure", (t) => {
 const styles = [];
 const { Tool } = harness(t, {
  fg(color, text) { styles.push({ color, text }); return text; },
  bold(text) { return `<bold>${text}</bold>`; },
 });
 const tool = new Tool();
 for (const [partial, started, error, color, info] of [
  [true, false, false, "muted", "waiting"],
  [true, true, false, "warning", "running"],
  [false, true, false, "success", "2 lines"],
  [false, true, true, "error", "2 lines"],
 ]) {
  styles.length = 0;
  tool.isPartial = partial; tool.executionStarted = started; tool.result.isError = error;
  const lines = tool.render(100);
  assert.ok(styles.some((s) => s.color === color && s.text === " ● "));
  assert.ok(styles.some((s) => s.color === "success" && s.text === "<bold>bash</bold>"));
  assert.ok(styles.some((s) => s.color === "dim" && s.text.includes("echo hello")));
  assert.ok(lines[0].includes(info));
  assert.equal(lines.length, error ? 3 : 1);
 }
});

test("summaries stop at actual and escaped newlines without changing full output", (t) => {
 const { Tool } = harness(t);
 for (const command of ["first\nsecond", "first\r\nsecond", "first\rsecond", "first\\nsecond"]) {
  const tool = new Tool("bash", { command });
  assert.match(tool.render(100)[0], /first/);
  assert.doesNotMatch(tool.render(100)[0], /second|\\n/);
  assert.equal(tool.args.command, command);
  click(tool);
  assert.deepEqual(tool.render(100).slice(1).map((line) => line.trimEnd()), ["    │ hello", "    │ world"]);
 }
});

test("details wrap inside indentation and fit narrow terminals", (t) => {
 const { Tool } = harness(t);
 const tool = new Tool("bash", { command: "你好世界".repeat(40) });
 tool.result.content[0].text = "你好世界".repeat(40);
 tool.setExpanded(true);
 for (const width of [2, 10, 40, 100]) {
  assert.ok(tool.render(width).every((line) => visibleWidth(line) <= width));
 }
 const lines = tool.render(40);
 assert.ok(lines.length > 2);
 assert.ok(lines.slice(1).every((line) => line.startsWith("    │ ")));
 assert.doesNotMatch(lines.join("\n"), /Took|timeout|native preview/);
});

test("preserves result renderer highlighting and translates detail mouse geometry", (t) => {
 const { Tool } = harness(t);
 const tool = new Tool("read");
 let mouse, renderedWidth;
 tool.resultRendererComponent = {
  render(width) { renderedWidth = width; return ["\u001b[32mconst value = 1\u001b[39m"]; },
  handleMouse(event) { mouse = event; return { handled: true }; },
 };
 tool.setExpanded(true);
 assert.match(tool.render(80)[1], /\u001b\[32mconst value/);
 assert.equal(renderedWidth, 74);
 tool.handleMouse({ type: "click", button: "left", x: 8, y: 1, width: 80, height: 2 });
 assert.deepEqual({ x: mouse.x, y: mouse.y, width: mouse.width, height: mouse.height }, { x: 2, y: 0, width: 74, height: 1 });
});

test("native mutation and image previews bypass folding; reset and dispose restore behavior", (t) => {
 const { Tool, folding, original } = harness(t);
 assert.equal(folding.toggle(), false);
 for (const name of ["edit", "write", "read"]) {
  const tool = new Tool(name);
  if (name === "read") tool.imageComponents = [{}];
  assert.deepEqual(tool.render(100), ["native preview"]);
  click(tool);
  assert.equal(tool.lastMouse.y, 0);
 }
 const tool = new Tool(); tool.argsPending = true;
 tool.render(100);
 assert.equal(tool.argsPending, false);
 assert.equal(folding.toggle(), true);
 folding.reset();
 assert.equal(folding.toggle(), false);
 folding.dispose();
 assert.equal(Tool.prototype.render, original);
});
