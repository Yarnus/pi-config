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
