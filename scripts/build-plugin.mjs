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
const tokenFile = path.join(repoRoot, ".local", "zotero-agent-token.txt");
const tokenPlaceholder = "__ZOTERO_AGENT_TOKEN__";

function readToken() {
  const envToken = process.env.ZOTERO_AGENT_TOKEN?.trim() || process.env.ZOTERO_AGENT_BRIDGE_TOKEN?.trim();
  if (envToken) {
    return envToken;
  }
  if (existsSync(tokenFile)) {
    const fileToken = readFileSync(tokenFile, "utf8").trim();
    if (fileToken) {
      return fileToken;
    }
  }
  throw new Error(
    [
      "Missing Zotero agent token.",
      "Set ZOTERO_AGENT_TOKEN or create .local/zotero-agent-token.txt.",
      "You can generate one with: node scripts/generate-token.mjs --write"
    ].join(" ")
  );
}

function replacePlaceholder(filePath, token) {
  const source = readFileSync(filePath, "utf8");
  writeFileSync(filePath, source.replaceAll(tokenPlaceholder, token), "utf8");
}

if (!existsSync(pluginSourceDir)) {
  throw new Error(`Plugin directory not found: ${pluginSourceDir}`);
}

const token = readToken();

mkdirSync(buildsDir, { recursive: true });
rmSync(scratchDir, { recursive: true, force: true });
rmSync(outFile, { force: true });
cpSync(pluginSourceDir, stagedPluginDir, { recursive: true });

replacePlaceholder(path.join(stagedPluginDir, "prefs.js.template"), token);
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
