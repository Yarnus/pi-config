import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { installFolding } from "./support.ts";

export default function (pi: ExtensionAPI) {
 let folding: ReturnType<typeof installFolding> | undefined;
 pi.on("session_start", async (_event, ctx) => {
  if (ctx.mode !== "tui") return;
  const components = await import("@earendil-works/pi-coding-agent");
  folding = installFolding(components, () => ctx.ui.theme);
 });
 pi.on("session_tree", () => folding?.reset());
 pi.on("session_compact", () => folding?.reset());
 pi.on("session_shutdown", () => { folding?.dispose(); folding = undefined; });
 pi.registerCommand("tool-fold", {
  description: "Toggle the latest tool output (Ctrl+O expands all tool outputs)",
  handler: async (_args, ctx) => {
   if (!folding?.toggle()) ctx.ui.notify("No tool output to toggle", "info");
  },
 });
}
