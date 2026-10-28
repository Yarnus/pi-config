import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

test("Pi discovers native resources, excludes shared skills, and resolves the default model", async (t) => {
	const agentDir = resolve("agent");
	let piRoot = dirname(realpathSync(execFileSync("/bin/sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim()));
	while (piRoot !== dirname(piRoot)) {
		const manifest = join(piRoot, "package.json");
		if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") break;
		piRoot = dirname(piRoot);
	}
	assert.notEqual(piRoot, dirname(piRoot), "Pi executable must resolve to its npm package");
	const core = join(piRoot, "dist/core");
	const home = mkdtempSync(join(tmpdir(), "pi-resources-"));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const shared = join(home, ".agents/skills/should-not-load");
	mkdirSync(shared, { recursive: true });
	writeFileSync(join(shared, "SKILL.md"), "---\nname: should-not-load\ndescription: Shared skill excluded by Pi dotfiles.\n---\nSynthetic skill\n");
	process.env.HOME = home;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	process.env.PI_OFFLINE = "1";
	const load = (name) => import(pathToFileURL(join(core, `${name}.js`)).href);
	const { DefaultResourceLoader } = await load("resource-loader");
	const { SettingsManager } = await load("settings-manager");
	const settings = JSON.parse(readFileSync(join(agentDir, "settings.json")));
	const loader = new DefaultResourceLoader({ cwd: home, agentDir, settingsManager: SettingsManager.inMemory(settings, { projectTrusted: false }) });
	await loader.reload();
	const { extensions, errors } = loader.getExtensions();
	assert.deepEqual(errors, []);
	const paths = extensions.map((extension) => relative(agentDir, extension.path));
	for (const path of ["extensions/ask-user-question.ts", "extensions/chrono-413-recovery.ts", "extensions/plan-mode.ts", "extensions/notify.ts", "extensions/response-time.ts", "extensions/statusline/index.ts"]) {
		assert.ok(paths.includes(path), `Missing extension: ${path}; loaded ${paths}`);
	}
	for (const source of settings.packages.filter((source) => typeof source === "string" && source.startsWith("npm:"))) {
		const name = source.slice(4).replace(/@[^/]*$/, "");
		assert.ok(paths.some((path) => path.startsWith(`npm/node_modules/${name}/`)), `Missing package extension: ${name}; loaded ${paths}`);
		const installed = JSON.parse(readFileSync(join(agentDir, "npm/node_modules", name, "package.json"), "utf8"));
		assert.equal(source, `npm:${name}@${installed.version}`, `Package must be pinned to its installed version: ${name}`);
	}
	assert.ok(paths.every((path) => !/plan-todo|prompt-snippets|pi-plan-mode|pi-todo|pi-thinking-steps|packages\/my-pi/.test(path)));
	const tools = extensions.flatMap((extension) => [...extension.tools.keys()]);
	for (const name of ["ask_user_question", "web_search", "fetch_content", "todo"]) assert.ok(tools.includes(name), `Missing tool: ${name}`);
	for (const name of ["subagents-doctor", "todos", "btw", "plan"]) assert.ok(extensions.some((extension) => extension.commands.has(name)), `Missing command: ${name}`);
	assert.equal(new Set(tools).size, tools.length, "Duplicate tool registrations");
	const { skills, diagnostics } = loader.getSkills();
	assert.deepEqual(diagnostics.filter((entry) => entry.type === "collision"), []);
	const names = skills.map((skill) => skill.name);
	const expectedGitSkills = ["code-review", "codebase-design", "diagnosing-bugs", "domain-modeling", "frontend-design", "grilling", "implement", "improve-codebase-architecture", "prototype", "research", "setup-matt-pocock-skills", "tdd", "teach", "to-questionnaire", "to-spec", "to-tickets", "triage", "wait-what", "wayfinder", "wizard", "writing-for-agents"];
	assert.ok(names.includes("pdf-reader"));
	assert.deepEqual(skills.filter((skill) => skill.filePath.startsWith(join(agentDir, "git/"))).map((skill) => skill.name).sort(), expectedGitSkills.sort());
	for (const name of ["grill-me", "grill-with-docs", "resolving-merge-conflicts"]) assert.ok(!names.includes(name), `Unexpected skill: ${name}`);
	for (const name of ["should-not-load", "find-skills", "analyze-sessions"]) assert.ok(!names.includes(name), `Unexpected skill: ${name}`);
	assert.ok(skills.every((skill) => !skill.filePath.includes("/.agents/skills/")));
	assert.equal(settings.theme, "paper-light/paper-dark");
	for (const name of settings.theme.split("/")) {
		assert.ok(loader.getThemes().themes.some((theme) => theme.name === name), `Missing theme: ${name}`);
	}
	const { AuthStorage } = await load("auth-storage");
	const { ModelRuntime } = await load("model-runtime");
	const models = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: join(agentDir, "models.json"), modelsStorePath: join(home, "models-store.json"), allowModelNetwork: false, refreshOnCreate: false });
	assert.equal(models.getError(), undefined);
	assert.ok(models.getModel(settings.defaultProvider, settings.defaultModel));
	const executor = settings.subagents.agentOverrides["plan-executor"];
	assert.equal(executor.model, "openai-codex/gpt-6-luna");
	assert.equal(executor.thinking, "max");
	assert.ok(models.getModel("openai-codex", "gpt-6-luna"));
	assert.equal(settings.subagents.agentOverrides.worker, undefined);
	// Agent discovery has no public export; validate it against the pinned package's published module.
	const { discoverAgents } = await import(pathToFileURL(join(agentDir, "npm/node_modules/pi-subagents/src/agents/agents.js")).href);
	const agent = discoverAgents(home, "user").agents.find((entry) => entry.name === "plan-executor");
	assert.ok(agent, "Missing plan-executor agent");
	assert.equal(agent.model, executor.model);
	assert.equal(agent.thinking, executor.thinking);
	assert.equal(agent.defaultContext, "fresh");
	assert.equal(agent.inheritProjectContext, true);
	assert.equal(agent.inheritGlobalContext, true);
	assert.ok(agent.tools.includes("contact_supervisor"));
	assert.ok(!agent.tools.includes("subagent"));
});
