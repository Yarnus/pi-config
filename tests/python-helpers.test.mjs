import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("PDF math fixtures", () => {
	const result = spawnSync("python3", ["-B", "-m", "unittest", "discover", "-s", "tests", "-p", "*_test.py", "-v"], { encoding: "utf8" });
	assert.equal(result.status, 0, `${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
});
