import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const pluginSourceDir = path.join(repoRoot, "plugin");
const buildsDir = path.join(repoRoot, "builds");
const scratchDir = path.join(repoRoot, ".build");
const stagedPluginDir = path.join(scratchDir, "plugin");
const outFile = path.join(buildsDir, "zotero-local-agent-management.xpi");

if (!existsSync(pluginSourceDir)) {
  throw new Error(`Plugin directory not found: ${pluginSourceDir}`);
}

mkdirSync(buildsDir, { recursive: true });
rmSync(scratchDir, { recursive: true, force: true });
rmSync(outFile, { force: true });
cpSync(pluginSourceDir, stagedPluginDir, { recursive: true });

writeFileSync(
  path.join(stagedPluginDir, "prefs.js"),
  readFileSync(path.join(stagedPluginDir, "prefs.js.template"), "utf8"),
  "utf8"
);
rmSync(path.join(stagedPluginDir, "prefs.js.template"), { force: true });

execFileSync("zip", ["-qr", outFile, "."], {
  cwd: stagedPluginDir,
  stdio: "inherit"
});

console.log(`Built ${outFile}`);
