import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

interface TimingData {
	elapsedMs: number;
	outcome: "completed" | "interrupted" | "error" | "length";
}

export function formatDuration(elapsedMs: number): string {
	const seconds = Math.floor(Math.max(0, elapsedMs) / 1000);
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
	return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}

export default function responseTimeExtension(pi: ExtensionAPI) {
	let startedAt: number | undefined;
	let outcome: TimingData["outcome"] = "completed";

	pi.registerEntryRenderer<TimingData>("response-time", (entry, _options, theme) => ({
		invalidate() {},
		render(width) {
			if (!entry.data) return [];
			const labels = {
				completed: "Elapsed:",
				interrupted: "Interrupted after",
				error: "Failed after",
				length: "Output limit reached after",
			};
			const text = `${labels[entry.data.outcome]} ${formatDuration(entry.data.elapsedMs)}`;
			return [truncateToWidth(` ${theme.fg("dim", text)}`, width)];
		},
	}));

	// Keep one span across tool turns, automatic retries, and queued continuations.
	pi.on("before_agent_start", (_event, ctx) => {
		if (ctx.mode !== "tui" || startedAt !== undefined) return;
		startedAt = performance.now();
		outcome = "completed";
	});

	pi.on("agent_end", (event) => {
		if (startedAt === undefined) return;
		const last = event.messages.findLast((message) => message.role === "assistant");
		if (last?.role !== "assistant") return;
		outcome = last.stopReason === "aborted" ? "interrupted"
			: last.stopReason === "error" ? "error"
				: last.stopReason === "length" ? "length" : "completed";
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (startedAt === undefined || !ctx.isIdle()) return;
		const elapsedMs = performance.now() - startedAt;
		startedAt = undefined;
		pi.appendEntry<TimingData>("response-time", { elapsedMs, outcome });
	});

	pi.on("session_shutdown", () => {
		startedAt = undefined;
	});
}
