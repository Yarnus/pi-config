import * as fs from "node:fs";
import { dirname, join, relative as relativePath, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const agent = join(root, "agent");
const check = process.argv[2] === "--check";
const problems = [];
const json = (path) => JSON.parse(fs.readFileSync(path, "utf8"));
const stat = (path) => fs.lstatSync(path, { throwIfNoEntry: false });
function command(bin, args, options = {}) {
	const result = spawnSync(bin, args, { cwd: root, encoding: "utf8", env: { ...process.env, PI_OFFLINE: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }, ...options });
	if (result.error || result.status !== 0) throw new Error(`${bin} ${args.join(" ")}: ${result.error?.message ?? result.stderr ?? result.status}`);
	return result.stdout?.trim() ?? "";
}
function report(message) { problems.push(message); console.error(message); }
function linked(path, target) { return stat(path)?.isSymbolicLink() && resolve(dirname(path), fs.readlinkSync(path)) === target; }
function packageInfo(source) {
	const match = /^npm:((?:@[\w.-]+\/)?[\w.-]+)@(\d+\.\d+\.\d+(?:-[\w.-]+)?)$/.exec(source);
	if (match) return { source, name: match[1], path: join(agent, "npm/node_modules", match[1]), version: match[2] };
	throw new Error(`Unsupported or unpinned package: ${source}`);
}
function revisionProblem(path, commit) {
	if (!stat(path)) return `MISSING ${path}`;
	try {
		if (command("git", ["-C", path, "rev-parse", "HEAD"]) !== commit) return `DRIFT revision ${path}`;
		if (command("git", ["-C", path, "status", "--porcelain", "--untracked-files=normal"])) return `DRIFT modified checkout ${path}`;
	} catch { return `DRIFT invalid checkout ${path}`; }
}
function packageProblem(pkg) {
	try {
		if (json(join(pkg.path, "package.json")).version === pkg.version && json(join(agent, "npm/package.json")).dependencies?.[pkg.name] === pkg.version) return;
	} catch {}
	return `${stat(pkg.path) ? "DRIFT" : "MISSING"} ${pkg.source}`;
}
function installedPiVersion() {
	const probe = spawnSync("/bin/sh", ["-c", "command -v pi"], { encoding: "utf8" });
	if (probe.status === 1 || probe.status === 127) return;
	if (probe.error || probe.status !== 0) throw new Error("Cannot locate pi on PATH");
	// Read the package owning the actual executable; starting Pi can mutate settings.
	for (let dir = dirname(fs.realpathSync(probe.stdout.trim())); dir !== dirname(dir); dir = dirname(dir)) {
		const path = join(dir, "package.json");
		if (stat(path)) {
			const pkg = json(path);
			if (pkg.name === "@earendil-works/pi-coding-agent") return pkg.version;
		}
	}
	throw new Error("Cannot identify the Pi npm installation; use mise exec -- ./setup-pi.sh");
}
try {
	if (process.argv.length !== (check ? 3 : 2)) throw new Error("Usage: ./setup-pi.sh [--check]");
	if (process.env.PI_CODING_AGENT_DIR && resolve(process.env.PI_CODING_AGENT_DIR) !== agent) throw new Error("Unset PI_CODING_AGENT_DIR: setup manages this repository's agent directory.");
	const manifest = json(join(root, "package.json"));
	const settingsPath = join(agent, "settings.json"), settingsText = fs.readFileSync(settingsPath, "utf8");
	const settings = JSON.parse(settingsText);
	const packages = settings.packages.map((entry) => packageInfo(typeof entry === "string" ? entry : entry.source));
	const sources = json(join(root, "external-skills.json"));
	const skillNames = new Set();
	for (const source of sources) {
		if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(source.repository) || !/^[a-f0-9]{40}$/.test(source.commit)) throw new Error("External skills require a GitHub source and immutable commit");
		for (const [name, path] of Object.entries(source.skills)) {
			if (!/^[\w-]+$/.test(name) || !/^[\w./-]+$/.test(path) || path.startsWith("/") || path.split("/").includes("..") || skillNames.has(name)) throw new Error(`Invalid/duplicate skill: ${name}`);
			skillNames.add(name);
			const destination = join(agent, "skills", name), target = join(agent, "external-skills", source.commit, path);
			if (stat(destination) && !linked(destination, target)) throw new Error(`Conflicting skill path: ${destination}; preserved`);
		}
	}
	const nodeVersion = /^node\s*=\s*"([\d.]+)"\s*$/m.exec(fs.readFileSync(join(root, "mise.toml"), "utf8"))?.[1];
	if (!nodeVersion || process.versions.node !== nodeVersion) throw new Error(`Node ${nodeVersion ?? "version from mise.toml"} required; use mise install and mise exec -- ./setup-pi.sh`);
	if (!/^\d+\.\d+\.\d+$/.test(manifest.piSetup?.version ?? "")) throw new Error("package.json must pin piSetup.version");
	command("npm", ["--version"]);
	command("git", ["--version"]);
	command("python3", ["-c", "import sys; assert sys.version_info >= (3, 10), 'Python 3.10+ required'"]);
	let piVersion = installedPiVersion();
	if (!piVersion) {
		if (check) report(`MISSING Pi ${manifest.piSetup.version}`);
		else {
			command("npm", ["install", "--global", "--ignore-scripts", `@earendil-works/pi-coding-agent@${manifest.piSetup.version}`], { stdio: "inherit" });
			piVersion = installedPiVersion();
			if (!piVersion) throw new Error("Pi installation did not provide an executable on PATH");
		}
	}
	if (piVersion && piVersion !== manifest.piSetup.version) throw new Error(`Pi version mismatch: ${piVersion}; required ${manifest.piSetup.version}. Switch explicitly: npm install --global --ignore-scripts @earendil-works/pi-coding-agent@${manifest.piSetup.version}`);

	if (!check) {
		command("npm", ["ci", "--include=dev"], { stdio: "inherit" });
		const venv = join(agent, "skills/pdf-reader/.venv");
		if (!fs.existsSync(join(venv, "bin/python"))) command("python3", ["-m", "venv", venv], { stdio: "inherit" });
		command(join(venv, "bin/python"), ["-m", "pip", "install", "-r", join(agent, "skills/pdf-reader/requirements.txt")], { stdio: "inherit" });
		// Official install runs against an isolated settings copy and shared install stores.
		// Keep native package installation from rewriting the tracked settings.
		const staging = fs.mkdtempSync(join(tmpdir(), "pi-dotfiles-install-"));
		try {
			fs.writeFileSync(join(staging, "settings.json"), settingsText);
			fs.mkdirSync(join(agent, "npm"), { recursive: true });
			fs.symlinkSync(join(agent, "npm"), join(staging, "npm"));
			for (const pkg of packages) {
				const problem = packageProblem(pkg);
				if (!problem) continue;
				command("pi", ["install", pkg.source, "--no-approve"], { cwd: staging, env: { ...process.env, PI_CODING_AGENT_DIR: staging, PI_OFFLINE: "1", GIT_TERMINAL_PROMPT: "0", npm_config_save_exact: "true" }, stdio: "inherit" });
				if (fs.readFileSync(join(staging, "settings.json"), "utf8") !== settingsText) throw new Error("Pi install unexpectedly changed settings; repository settings preserved");
			}
		} finally { fs.rmSync(staging, { recursive: true, force: true }); }
	}
	if (manifest.dependencies || manifest.devDependencies) {
		const lock = json(join(root, "package-lock.json"));
		for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
			try {
				if (json(join(root, "node_modules", name, "package.json")).version !== lock.packages[`node_modules/${name}`].version) report(`DRIFT dependency ${name}; run setup`);
			} catch { report(`MISSING dependency ${name}; run setup`); }
		}
	}
	try { command(join(agent, "skills/pdf-reader/.venv/bin/python"), ["-B", "-c", "import importlib.metadata, pathlib, sys; requirements = pathlib.Path(sys.argv[1]).read_text().splitlines(); assert all(importlib.metadata.version(name) == version for name, version in (line.split('==') for line in requirements if line and not line.startswith('#')))", join(agent, "skills/pdf-reader/requirements.txt")]); }
	catch { report("MISSING/DRIFT PDF Python environment; run setup"); }
	for (const pkg of packages) { const problem = packageProblem(pkg); if (problem) report(problem); }
	for (const source of sources) {
		const checkout = join(agent, "external-skills", source.commit);
		if (!check && !stat(checkout)) {
			fs.mkdirSync(dirname(checkout), { recursive: true });
			const temporary = fs.mkdtempSync(join(dirname(checkout), ".install-"));
			try {
				command("git", ["clone", "--no-checkout", source.repository, temporary], { stdio: "inherit" });
				command("git", ["-C", temporary, "checkout", "--detach", source.commit], { stdio: "inherit" });
				fs.renameSync(temporary, checkout);
			} finally { fs.rmSync(temporary, { recursive: true, force: true }); }
		}
		const problem = revisionProblem(checkout, source.commit);
		if (problem) { report(problem); continue; }
		for (const [name, relative] of Object.entries(source.skills)) {
			const target = join(checkout, relative), path = join(agent, "skills", name);
			if (!fs.existsSync(join(target, "SKILL.md"))) { report(`MISSING source skill ${target}`); continue; }
			if (!check && !stat(path)) { fs.mkdirSync(dirname(path), { recursive: true }); fs.symlinkSync(relativePath(dirname(path), target), path); }
			if (!linked(path, target)) report(`MISSING skill link ${path}; run setup`);
		}
	}
	if (fs.readFileSync(settingsPath, "utf8") !== settingsText) throw new Error("Repository settings changed during setup; inspect concurrent writers");
	if (problems.length) { console.error(`Setup validation failed: ${problems.length} issue(s); existing resources preserved.`); process.exitCode = 1; }
	else console.log(check ? "Pi environment matches repository declarations." : "Pi environment installed and verified. Restart Pi to load changes.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
