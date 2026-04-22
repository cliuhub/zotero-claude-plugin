import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const localDir = path.join(repoRoot, ".local");
const tokenFile = path.join(localDir, "zotero-agent-token.txt");

const token = randomBytes(24).toString("hex");

if (process.argv.includes("--write")) {
  mkdirSync(localDir, { recursive: true });
  writeFileSync(tokenFile, `${token}\n`, "utf8");
  console.log(tokenFile);
} else {
  console.log(token);
}
