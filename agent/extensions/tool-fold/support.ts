import { stripVTControlCharacters } from "node:util";
import { Text, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// These structural types isolate the dependency on Pi's component internals.
type Component = {
 render(width: number): string[];
 handleMouse?(event: any): any;
 setExpanded?(expanded: boolean): void;
 [key: string]: any;
};
const clean = (value: unknown) => stripVTControlCharacters(String(value ?? "")).replace(/[\r\n\t]+/g, " ");
const duration = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function installFolding(classes: Record<string, any>, getTheme: () => any) {
 let latest: Component | undefined;
 let layouts = new WeakMap<object, { body?: Component; indent: number; height: number }>();
 const restores: (() => void)[] = [];
 function patch(proto: any, name: string, wrap: (original: any) => any) {
  const own = Object.getOwnPropertyDescriptor(proto, name);
  const original = proto[name];
  const replacement = wrap(original);
  proto[name] = replacement;
  restores.push(() => {
   if (proto[name] !== replacement) return;
   if (own) Object.defineProperty(proto, name, own);
   else delete proto[name];
  });
 }
 const userProto = classes.UserMessageComponent?.prototype;
 if (userProto) {
  patch(userProto, "render", (original) => function(this: Component, width: number) {
   const lines = original.call(this, width);
   return lines.length ? [...lines, ""] : lines;
  });
 }
 const proto = classes.ToolExecutionComponent.prototype;
 patch(proto, "render", (original) => function(this: Component, width: number) {
  if (this.argsPending) this.updateDisplay();
  // Preserve mutation previews and image protocols without rewriting their shell.
  if (["edit", "write"].includes(this.toolName) || this.imageComponents?.length) {
   layouts.delete(this);
   return original.call(this, width);
  }
  latest = this;
  const theme = getTheme();
  const clip = (s: string) => truncateToWidth(s, Math.max(0, width));
  const args = this.args ?? {};
  const target = clean(String(args.command ?? args.path ?? args.pattern ?? args.query ?? args.action ?? "").split(/\r\n?|\n|\\n/, 1)[0]);
  const output = (this.result?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trimEnd();
  const pending = this.isPartial && !this.executionStarted;
  const color = this.isPartial ? pending ? "muted" : "warning" : this.result?.isError ? "error" : "success";
  const info = this.isPartial ? pending ? "waiting" : "running" : `${output ? output.split("\n").length : 0} lines · ${this.result?.durationMs === undefined ? "—" : duration(this.result.durationMs)}`;
  const left = theme.fg(color, " ● ") + theme.fg("success", theme.bold(clean(this.toolName))) + "  ";
  const right = `  ${info}`;
  const available = width - visibleWidth(left) - visibleWidth(right);
  const label = available > 0 ? truncateToWidth(target, available) : "";
  const pad = " ".repeat(Math.max(0, available - visibleWidth(label)));
  const lines = [clip(left + theme.fg("dim", label + pad + right))];
  const indent = Math.min(6, Math.max(0, width - 1));
  let body: Component | undefined;
  if (this.expanded || this.result?.isError) {
   // Read/custom result components retain highlighting; shell and call title are omitted.
   // Shell output is plain text so the native timing footer is not repeated.
   body = !["bash", "powershell"].includes(this.toolName) ? this.resultRendererComponent : undefined;
   body ??= new Text(theme.fg("dim", output), 0, 0);
   const prefix = theme.fg("dim", "    │ ".slice(0, indent));
   if (output || this.resultRendererComponent) {
    lines.push(...body.render(Math.max(1, width - indent)).map((line) => clip(prefix + line)));
   }
  }
  layouts.set(this, { body, indent, height: lines.length - 1 });
  return lines;
 });
 patch(proto, "handleMouse", (original) => function(this: Component, event: any) {
  const layout = layouts.get(this);
  if (!layout) return original?.call(this, event);
  if (event.type === "click" && event.button === "left" && event.y === 0) {
   this.setExpanded?.(!this.expanded);
   this.ui?.requestRender();
   return { handled: true };
  }
  if (layout.body && event.y >= 1 && event.y <= layout.height && event.x >= layout.indent) {
   return layout.body.handleMouse?.({ ...event, x: event.x - layout.indent, y: event.y - 1,
    width: Math.max(1, event.width - layout.indent), height: layout.height });
  }
 });
 return {
  toggle() {
   if (!latest) return false;
   latest.setExpanded?.(!latest.expanded);
   latest.ui?.requestRender();
   return true;
  },
  reset() { layouts = new WeakMap(); latest = undefined; },
  dispose() { restores.reverse().forEach((restore) => restore()); },
 };
}
