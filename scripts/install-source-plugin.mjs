import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const pluginDir = path.join(repoRoot, "plugin");
const prefsTemplatePath = path.join(pluginDir, "prefs.js.template");
const pluginPrefsPath = path.join(pluginDir, "prefs.js");
const manifestPath = path.join(pluginDir, "manifest.json");

function parseIni(source) {
  const sections = [];
  let current = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[") && line.endsWith("]")) {
      current = { name: line.slice(1, -1), values: {} };
      sections.push(current);
      continue;
    }
    const separator = line.indexOf("=");
    if (separator === -1 || !current) {
      continue;
    }
    current.values[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return sections;
}

function resolveProfilesIni() {
  const homeDir = os.homedir();
  const candidates = [
    path.join(homeDir, "Library", "Application Support", "Zotero", "profiles.ini"),
    path.join(homeDir, ".zotero", "zotero", "profiles.ini"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Could not find Zotero profiles.ini");
  }
  return found;
}

function resolveDefaultProfileDir() {
  const profilesIni = resolveProfilesIni();
  const baseDir = path.dirname(profilesIni);
  const profiles = parseIni(readFileSync(profilesIni, "utf8"))
    .filter((section) => section.name.startsWith("Profile"));
  if (profiles.length === 0) {
    throw new Error(`No Zotero profiles found in ${profilesIni}`);
  }
  const profile = profiles.find((section) => section.values.Default === "1") || profiles[0];
  const profilePath = profile.values.Path;
  if (!profilePath) {
    throw new Error(`Profile entry ${profile.name} is missing Path`);
  }
  if (profile.values.IsRelative === "0") {
    return profilePath;
  }
  return path.join(baseDir, profilePath);
}

function readAddonID() {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const addonID = manifest?.applications?.zotero?.id;
  if (!addonID) {
    throw new Error("plugin/manifest.json is missing applications.zotero.id");
  }
  return addonID;
}

function materializePluginPrefs() {
  const template = readFileSync(prefsTemplatePath, "utf8");
  writeFileSync(pluginPrefsPath, template, "utf8");
}

function resetExtensionCache(profileDir) {
  const prefsPath = path.join(profileDir, "prefs.js");
  if (!existsSync(prefsPath)) {
    return false;
  }
  const source = readFileSync(prefsPath, "utf8");
  const filtered = source
    .split(/\r?\n/)
    .filter((line) => !line.includes("extensions.lastAppBuildId") && !line.includes("extensions.lastAppVersion"));
  const next = `${filtered.filter(Boolean).join("\n")}\n`;
  if (next === source) {
    return false;
  }
  writeFileSync(prefsPath, next, "utf8");
  return true;
}

function installProxyFile(profileDir, addonID) {
  const extensionsDir = path.join(profileDir, "extensions");
  mkdirSync(extensionsDir, { recursive: true });
  const proxyPath = path.join(extensionsDir, addonID);
  writeFileSync(proxyPath, `${pluginDir}\n`, "utf8");
  return proxyPath;
}

const profileDir = process.argv[2] ? path.resolve(process.argv[2]) : resolveDefaultProfileDir();
const addonID = readAddonID();
materializePluginPrefs();
const proxyPath = installProxyFile(profileDir, addonID);
const cacheReset = resetExtensionCache(profileDir);

console.log(JSON.stringify({
  ok: true,
  addonID,
  profileDir,
  proxyPath,
  pluginDir,
  pluginPrefsPath,
  cacheReset,
  restartRequired: true,
  activationHint: "If /agent/command still returns 404 after restart, install builds/zotero-local-agent-management.xpi once from Zotero Tools -> Plugins."
}, null, 2));
