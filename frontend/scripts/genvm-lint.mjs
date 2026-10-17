// Portable genvm-lint runner for the frontend project.
// - Sets PYTHONIOENCODING=utf-8 (plain `genvm-lint` crashes on Windows with a
//   Unicode traceback inside its own output).
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
const r = spawnSync(`genvm-lint check "${contract}"`, {
  stdio: "inherit",
  shell: true, // Windows .cmd/.ps1 shims need a shell
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
});
process.exit(r.status ?? 1);
