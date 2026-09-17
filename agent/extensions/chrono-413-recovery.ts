import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { FetchFunction, ProviderResponse, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { ContextEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "chrono";
const OVERFLOW_MARKER = "request_too_large";
const { streamSimple: streamOpenAICompletions } = openAICompletionsApi();

function responseHeaders(headers: Headers): Record<string, string> {
	return Object.fromEntries(headers.entries());
}

export function omitPreviousTurnImages(messages: ContextEvent["messages"]): ContextEvent["messages"] {
	let currentTurnStart = -1;
	for (let index = messages.length - 1; index >= 0; index--) {
		if (messages[index].role === "user") {
			currentTurnStart = index;
			break;
		}
	}
	if (currentTurnStart <= 0) return messages;

	let changed = false;
	const result = messages.map((message, index) => {
		if (index >= currentTurnStart) return message;
		if (message.role !== "user" && message.role !== "toolResult" && message.role !== "custom") return message;
		if (typeof message.content === "string") return message;

		const content = message.content.filter((block) => block.type !== "image");
		if (content.length === message.content.length) return message;

		changed = true;
		return {
			...message,
			content: content.length > 0 ? content : [{ type: "text" as const, text: "[Image omitted from previous turn]" }],
		} as typeof message;
	});

	return changed ? result : messages;
}

/**
 * The OpenAI SDK throws for non-2xx responses before Pi's built-in
 * after_provider_response callback runs. Observe the real HTTP response at the
 * fetch boundary and forward only 413 so the extension never infers status from
 * an error string.
 */
export function observe413(fetchImpl: FetchFunction, on413: (response: ProviderResponse) => void | Promise<void>): FetchFunction {
	return async (input, init) => {
		const response = await fetchImpl(input, init);
		if (response.status === 413) {
			await on413({ status: response.status, headers: responseHeaders(response.headers) });
		}
		return response;
	};
}

/**
 * Normalize Chrono's HTTP 413 response into an overflow error Pi recognizes.
 * Pi then performs its native bounded recovery: compact the context and retry
 * the interrupted turn once.
 */
export default function chrono413Recovery(pi: ExtensionAPI) {
	let received413 = false;

	const reset = () => {
		received413 = false;
	};

	pi.registerProvider(PROVIDER, {
		api: "openai-completions",
		streamSimple: (model, context, options?: SimpleStreamOptions) => {
			const fetchImpl = options?.fetch ?? globalThis.fetch;
			return streamOpenAICompletions(model, context, {
				...options,
				fetch: observe413(fetchImpl, async (response) => {
					await options?.onResponse?.(response, model);
				}),
			});
		},
	});

	pi.on("session_start", reset);
	pi.on("session_shutdown", reset);

	pi.on("context", (event, ctx) => {
		if (ctx.model?.provider !== PROVIDER) return;

		const messages = omitPreviousTurnImages(event.messages);
		if (messages !== event.messages) return { messages };
	});

	// Clear stale response state before each logical provider request.
	pi.on("before_provider_request", (_event, ctx) => {
		if (ctx.model?.provider === PROVIDER) reset();
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (ctx.model?.provider === PROVIDER && event.status === 413) {
			received413 = true;
		}
	});

	pi.on("message_end", (event) => {
		if (!received413) return;

		// Consume the marker even if the provider produces an unexpected message so
		// it can never leak into a later turn.
		reset();

		const message = event.message;
		if (message.role !== "assistant" || message.provider !== PROVIDER || message.stopReason !== "error") return;

		const originalError = message.errorMessage?.trim();
		return {
			message: {
				...message,
				errorMessage: `${OVERFLOW_MARKER} (HTTP 413)${originalError ? `: ${originalError}` : ""}`,
			},
		};
	});
}
