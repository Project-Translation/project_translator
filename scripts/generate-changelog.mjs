#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trimEnd();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function toLines(text) {
  return text
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);
}

const root = process.cwd();
const packageJsonPath = resolve(root, "package.json");
const pkg = readJson(packageJsonPath);
const currentVersion = typeof pkg?.version === "string" ? pkg.version.trim() : "";
const currentTag = currentVersion ? `v${currentVersion}` : "";

const allTags = toLines(git(["tag", "--list", "v*", "--sort=-v:refname"]));
const latestTagged = allTags[0] || "";

const entries = [];

// If current version is not tagged yet (release not tagged), treat HEAD as current version entry.
if (currentTag && latestTagged && latestTagged !== currentTag) {
  entries.push({
    title: currentTag,
    toRef: "HEAD",
    fromRef: latestTagged,
    date: git(["log", "-1", "--format=%cs", "HEAD"]),
  });
}

// Add the latest tags (up to 10, but minus the HEAD entry if present).
const maxVersions = 10;
const remainingSlots = Math.max(0, maxVersions - entries.length);
const tagsToShow = allTags.slice(0, remainingSlots);

for (const tag of tagsToShow) {
  const idx = allTags.indexOf(tag);
  const prev = idx >= 0 ? allTags[idx + 1] : "";
  if (!prev) {
    continue;
  }
  entries.push({
    title: tag,
    toRef: tag,
    fromRef: prev,
    date: git(["log", "-1", "--format=%cs", tag]),
  });
}

const sections = [];
sections.push("# Changelog");
sections.push("");
sections.push("> Generated automatically from git history. Only the latest 10 versions are kept.");
sections.push("");

for (const entry of entries) {
  const header = `## ${entry.title} (${entry.date})`;
  sections.push(header);
  sections.push("");
  const range = `${entry.fromRef}..${entry.toRef}`;
  const commitLines = toLines(git(["log", "--no-merges", "--pretty=format:%s (%h)", range]));
  if (commitLines.length === 0) {
    sections.push("- (no changes)");
  } else {
    for (const line of commitLines) {
      sections.push(`- ${line}`);
    }
  }
  sections.push("");
}

writeFileSync(resolve(root, "CHANGELOG.md"), `${sections.join("\n")}\n`, "utf8");
console.log(`✅ Wrote CHANGELOG.md (${entries.length} versions)`);

