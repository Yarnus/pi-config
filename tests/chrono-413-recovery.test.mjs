import assert from "node:assert/strict";
import test from "node:test";
import chrono413Recovery, { observe413, omitPreviousTurnImages } from "../agent/extensions/chrono-413-recovery.ts";

function loadExtension() {
	const handlers = new Map();
	let providerConfig;
	const pi = {
		on(name, handler) {
			handlers.set(name, handler);
		},
		registerProvider(name, config) {
			assert.equal(name, "chrono");
			providerConfig = config;
		},
	};

	chrono413Recovery(pi);
	return { handlers, providerConfig };
}

function assistantError(provider = "chrono") {
	return {
		role: "assistant",
		content: [],
		api: "openai-completions",
		provider,
		model: "test",
		usage: {},
		stopReason: "error",
		errorMessage: "upstream failure",
		timestamp: 1,
	};
}

test("a real Chrono HTTP 413 becomes a native overflow error", async () => {
	const { handlers } = loadExtension();
	const ctx = { model: { provider: "chrono" } };
	await handlers.get("before_provider_request")({}, ctx);

	const fetch413 = observe413(
		async () => new Response("nginx", { status: 413 }),
		(response) => handlers.get("after_provider_response")(response, ctx),
	);
	await fetch413("https://example.invalid");

	const result = await handlers.get("message_end")({ message: assistantError() });
	assert.match(result.message.errorMessage, /^request_too_large \(HTTP 413\)/);
});

test("status 500 with text mentioning 413 is unchanged", async () => {
	const { handlers } = loadExtension();
	const ctx = { model: { provider: "chrono" } };
	await handlers.get("before_provider_request")({}, ctx);

	const fetch500 = observe413(
		async () => new Response("413 Request Entity Too Large", { status: 500 }),
		(response) => handlers.get("after_provider_response")(response, ctx),
	);
	await fetch500("https://example.invalid");

	assert.equal(await handlers.get("message_end")({ message: assistantError() }), undefined);
});

test("a non-Chrono HTTP 413 is unchanged", async () => {
	const { handlers } = loadExtension();
	const ctx = { model: { provider: "other" } };
	await handlers.get("after_provider_response")({ status: 413, headers: {} }, ctx);
	assert.equal(await handlers.get("message_end")({ message: assistantError("other") }), undefined);
});

test("images from previous turns are omitted only from Chrono request context", async () => {
	const { handlers } = loadExtension();
	const previousImage = { type: "image", data: "old-image", mimeType: "image/png" };
	const currentImage = { type: "image", data: "current-image", mimeType: "image/png" };
	const messages = [
		{ role: "user", content: [{ type: "text", text: "old request" }, previousImage], timestamp: 1 },
		assistantError(),
		{ role: "user", content: [{ type: "text", text: "current request" }, currentImage], timestamp: 2 },
	];

	const chrono = await handlers.get("context")({ messages }, { model: { provider: "chrono" } });
	assert.deepEqual(chrono.messages[0].content, [{ type: "text", text: "old request" }]);
	assert.equal(chrono.messages[2].content[1], currentImage);
	assert.equal(messages[0].content[1], previousImage);

	assert.equal(await handlers.get("context")({ messages }, { model: { provider: "other" } }), undefined);
	assert.equal(omitPreviousTurnImages(messages).at(-1).content[1], currentImage);
});
