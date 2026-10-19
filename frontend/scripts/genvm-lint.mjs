// Portable genvm-lint runner for the frontend project.
// - Sets PYTHONIOENCODING=utf-8 (plain `genvm-lint` crashes on Windows with a
//   Unicode traceback inside its own output).
// - Falls back to the Python package (genvm_linter.cli) when the console
//   script exe is blocked by Windows Device Guard / not on PATH.
// - Resolves the contract relative to this package, so `npm run lint:genvm`
//   works from frontend/ regardless of shell.
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contract = process.argv[2]
  ?? resolve(here, "..", "..", "contracts", "veritasphere.py");

console.log(`genvm-lint check ${contract}`);
// shell:true → quote the path manually (project path contains spaces).
const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
let r = spawnSync(`genvm-lint check "${contract}"`, {
  stdio: "pipe",
  shell: true, // Windows .cmd/.ps1 shims need a shell
  env,
});
const out = (r.stdout?.toString() ?? "") + (r.stderr?.toString() ?? "");

if (r.status === 0) {
  process.stdout.write(out);
  process.exit(0);
}
if (/blocked|not recognized|not found|not be recognized/i.test(out)) {
  console.log("genvm-lint.exe unavailable — falling back to python genvm_linter.cli");
  r = spawnSync(
    "python",
    ["-c", "from genvm_linter.cli import main; import sys; sys.exit(main() or 0)", "check", contract],
    { stdio: "inherit", env }
  );
  process.exit(r.status ?? 1);
}
process.stdout.write(out);
process.exit(r.status ?? 1);
