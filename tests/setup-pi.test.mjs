import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync, readlinkSync, symlinkSync, rmSync, cpSync, existsSync, renameSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t) {
	const home = realpathSync(mkdtempSync(join(tmpdir(), "pi-setup-")));
	t.after(() => rmSync(home, { recursive: true, force: true }));
	const repo = join(home, "dotfiles with spaces"), bin = join(home, "bin"), agent = join(repo, "agent");
	mkdirSync(join(agent, "skills/pdf-reader"), { recursive: true }); mkdirSync(bin);
	cpSync(resolve("setup-pi.sh"), join(repo, "setup-pi.sh"));
	cpSync(resolve("scripts"), join(repo, "scripts"), { recursive: true });
	writeFileSync(join(agent, "settings.json"), JSON.stringify({ packages: ["npm:example-pi-package@1.2.3", "npm:second-package@1.2.3"] }));
	writeFileSync(join(agent, "auth.json"), '{"synthetic":"preserve"}');
	writeFileSync(join(agent, "skills/pdf-reader/requirements.txt"), "pymupdf==1.27.1\n");
	writeFileSync(join(repo, "package.json"), JSON.stringify({ piSetup: { version: "0.85.1" } }));
	writeFileSync(join(repo, "mise.toml"), `[tools]\nnode = "${process.versions.node}"\n`);
	writeFileSync(join(repo, "external-skills.json"), JSON.stringify([{ repository: "https://github.com/example/skills.git", commit: "a".repeat(40), skills: { "example-skill": "example-skill" } }]));
	symlinkSync(process.execPath, join(bin, "node"));
	const fake = `#!${process.execPath}
import fs from 'node:fs';
import path from 'node:path';
const bin = path.basename(process.argv[1]), args = process.argv.slice(2);
if (bin === 'pi' && args[0] === '--version') fs.writeFileSync(path.join(process.env.HOME, 'version-probe-mutation'), 'unexpected');
if (args[0] === '--version') { console.log(bin === 'pi' ? '0.85.1' : '1.0.0'); process.exit(0); }
if (bin === 'npm' && args[0] === 'ci') fs.writeFileSync('.dependencies-installed', 'yes');
else if (bin === 'npm' && args.includes('--global')) fs.symlinkSync(fs.readlinkSync(path.join(path.dirname(process.argv[1]), 'pi-template')), path.join(path.dirname(process.argv[1]), 'pi'));
else if (bin === 'python3' && args[1] === 'venv') {
  fs.mkdirSync(path.join(args[2], 'bin'), {recursive: true});
  fs.copyFileSync(process.argv[1], path.join(args[2], 'bin/python'));
  fs.chmodSync(path.join(args[2], 'bin/python'), 0o755);
} else if (bin === 'pi' && args[0] === 'install') {
  const store = path.join(process.env.PI_CODING_AGENT_DIR, 'npm');
  const manifestPath = path.join(store, 'package.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : {dependencies: {}};
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    if (version.startsWith('^')) fs.writeFileSync(path.join(store, 'node_modules', name, 'package.json'), JSON.stringify({version: '1.2.4'}));
  }
  const name = args[1].slice(4).split('@')[0];
  const dir = path.join(store, 'node_modules', name);
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({version: '1.2.3'}));
  manifest.dependencies[name] = (process.env.npm_config_save_exact === 'true' ? '' : '^') + '1.2.3';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
} else if (bin === 'git' && args[0] === 'clone') {
  fs.mkdirSync(path.join(args.at(-1), 'example-skill'), {recursive: true});
  fs.writeFileSync(path.join(args.at(-1), 'example-skill/SKILL.md'), 'Example skill');
} else if (bin === 'git' && args.includes('rev-parse')) console.log('a'.repeat(40));
else if (bin === 'git' && args.includes('status')) {
  if (fs.readFileSync(path.join(args[1], 'example-skill/SKILL.md'), 'utf8') !== 'Example skill') console.log(' M example-skill/SKILL.md');
} else if (bin === 'git' && args.includes('checkout')) {}
else if (!(bin === 'python' || (bin === 'python3' && args[0] === '-c'))) throw new Error('Unexpected command: ' + bin + ' ' + args);
`;
	for (const name of ["npm", "python3", "git"]) writeFileSync(join(bin, name), fake, { mode: 0o755 });
	const piPackage = join(home, "lib/node_modules/@earendil-works/pi-coding-agent");
	mkdirSync(join(piPackage, "dist"), { recursive: true });
	writeFileSync(join(piPackage, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.85.1", type: "module" }));
	writeFileSync(join(piPackage, "dist/pi"), fake, { mode: 0o755 });
	symlinkSync("../lib/node_modules/@earendil-works/pi-coding-agent/dist/pi", join(bin, "pi"));
	const env = { ...process.env, HOME: home, PI_CODING_AGENT_DIR: agent, PATH: `${bin}:/usr/bin:/bin` };
	return { home, agent, repo, env, run: (...args) => spawnSync("/bin/sh", [join(repo, "setup-pi.sh"), ...args], { env, encoding: "utf8" }) };
}
function snapshot(dir) {
	return readdirSync(dir).sort().map((name) => {
		const path = join(dir, name), stat = lstatSync(path);
		return [name, stat.isSymbolicLink() ? ["link", readlinkSync(path)] : stat.isDirectory() ? snapshot(path) : readFileSync(path, "utf8")];
	});
}

test("check is read-only; setup installs into native paths without changing config, auth, or shared skills", (t) => {
	const { home, agent, repo, run } = fixture(t);
	const before = snapshot(home);
	assert.notEqual(run("--check").status, 0);
	assert.deepEqual(snapshot(home), before);
	const settings = readFileSync(join(agent, "settings.json"), "utf8");
	const installed = run();
	assert.equal(installed.status, 0, installed.stderr);
	assert.equal(readFileSync(join(agent, "settings.json"), "utf8"), settings);
	assert.equal(lstatSync(join(agent, "settings.json")).isSymbolicLink(), false);
	assert.equal(readFileSync(join(agent, "auth.json"), "utf8"), '{"synthetic":"preserve"}');
	assert.ok(existsSync(join(repo, ".dependencies-installed")));
	assert.ok(existsSync(join(agent, "skills/pdf-reader/.venv/bin/python")));
	assert.ok(existsSync(join(agent, "npm/node_modules/example-pi-package/package.json")));
	assert.equal(readFileSync(join(agent, "skills/example-skill/SKILL.md"), "utf8"), "Example skill");
	assert.match(readlinkSync(join(agent, "skills/example-skill")), /^\.\.\/external-skills\//);
	assert.equal(existsSync(join(home, ".agents")), false);
	assert.equal(existsSync(join(agent, "packages")), false);
	const ready = snapshot(home);
	assert.equal(run().status, 0);
	assert.deepEqual(snapshot(home), ready);
	const checked = run("--check");
	assert.equal(checked.status, 0, checked.stderr);
	assert.deepEqual(snapshot(home), ready);
});

test("setup repairs saved npm ranges even when the installed version currently matches", (t) => {
	const { home, agent, run } = fixture(t);
	assert.equal(run().status, 0);
	const path = join(agent, "npm/package.json"), manifest = JSON.parse(readFileSync(path));
	manifest.dependencies["example-pi-package"] = "^1.2.3";
	writeFileSync(path, JSON.stringify(manifest));
	const before = snapshot(home);
	assert.notEqual(run("--check").status, 0);
	assert.deepEqual(snapshot(home), before);
	const result = run();
	assert.equal(result.status, 0, result.stderr);
	assert.equal(JSON.parse(readFileSync(path)).dependencies["example-pi-package"], "1.2.3");
});

test("relative skill links survive moving the repository", (t) => {
	const { repo, env, run } = fixture(t);
	assert.equal(run().status, 0);
	const moved = `${repo} moved`;
	renameSync(repo, moved);
	const result = spawnSync("/bin/sh", [join(moved, "setup-pi.sh"), "--check"], { env: { ...env, PI_CODING_AGENT_DIR: join(moved, "agent") }, encoding: "utf8" });
	assert.equal(result.status, 0, result.stderr);
	assert.equal(readFileSync(join(moved, "agent/skills/example-skill/SKILL.md"), "utf8"), "Example skill");
});

test("modified external checkouts are reported and preserved", (t) => {
	const { agent, run } = fixture(t);
	assert.equal(run().status, 0);
	writeFileSync(join(agent, "skills/example-skill/SKILL.md"), "Local edit");
	const result = run();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /DRIFT modified checkout/);
	assert.equal(readFileSync(join(agent, "skills/example-skill/SKILL.md"), "utf8"), "Local edit");
});

for (const kind of ["directory", "file", "symlink"]) {
	test(`setup preserves a conflicting ${kind} skill before installation`, (t) => {
		const { home, agent, run } = fixture(t), path = join(agent, "skills/example-skill");
		if (kind === "directory") mkdirSync(path);
		else if (kind === "file") writeFileSync(path, "local");
		else symlinkSync("missing-target", path);
		const before = snapshot(home);
		const result = run();
		assert.notEqual(result.status, 0);
		assert.match(result.stderr, /Conflicting skill path/);
		assert.deepEqual(snapshot(home), before);
	});
}

test("unknown arguments and skill traversal are rejected before mutations", (t) => {
	const { home, repo, run } = fixture(t);
	const before = snapshot(home);
	assert.notEqual(run("--typo").status, 0);
	assert.deepEqual(snapshot(home), before);
	writeFileSync(join(repo, "external-skills.json"), JSON.stringify([{ repository: "https://github.com/example/skills.git", commit: "a".repeat(40), skills: { example: "../escape" } }]));
	const invalid = snapshot(home), result = run();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Invalid\/duplicate skill/);
	assert.deepEqual(snapshot(home), invalid);
});

test("a different Pi version stops installation", (t) => {
	const { home, run } = fixture(t);
	writeFileSync(join(home, "lib/node_modules/@earendil-works/pi-coding-agent/package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "0.1.0", type: "module" }));
	const before = snapshot(home), result = run();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /Pi version mismatch/);
	assert.deepEqual(snapshot(home), before);
});

test("setup installs a missing Pi while check leaves it absent", (t) => {
	const { home, run } = fixture(t), pi = join(home, "bin/pi");
	renameSync(pi, join(home, "bin/pi-template"));
	const checked = run("--check");
	assert.notEqual(checked.status, 0);
	assert.match(checked.stderr, /MISSING Pi/);
	assert.equal(existsSync(pi), false);
	const installed = run();
	assert.equal(installed.status, 0, installed.stderr);
	assert.ok(existsSync(pi));
	assert.equal(run("--check").status, 0);
});

test("a failed dependency installation preserves configuration and runtime data", (t) => {
	const { home, agent, run } = fixture(t);
	writeFileSync(join(home, "bin/npm"), `#!${process.execPath}\nprocess.exit(process.argv[2] === '--version' ? 0 : 1);\n`, { mode: 0o755 });
	const before = snapshot(agent), result = run();
	assert.notEqual(result.status, 0);
	assert.match(result.stderr, /npm ci/);
	assert.deepEqual(snapshot(agent), before);
});
