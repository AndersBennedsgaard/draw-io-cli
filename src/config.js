import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CODE_LABEL_MODES } from "./lint.js";

/** The file name a repository commits its render and lint settings under. */
export const CONFIG_FILE = "drawio.config.json";

/** The label-format modes `lint.labelFormat` accepts. */
export const LABEL_FORMATS = ["strict", "off"];


/**
 * The settings from the nearest drawio.config.json, searched upward from the
 * input file's directory, or from an explicit path. Returns
 * `{ render: {scale, border}, lint: {labelFormat, verbs, subjects, codeLabels, palette, files}, path }`
 * with nulls for anything the file does not set, and all nulls when no file
 * is found. Throws on unreadable JSON or a wrongly typed value, since a broken
 * config must never fall back silently.
 *
 * @param inputPath - The diagram whose directory the upward search starts in.
 * @param explicitPath - A config file to read in place of the search.
 */
export function loadConfig(inputPath, explicitPath = null) {
  const candidate = explicitPath !== null ? resolve(explicitPath) : findConfig(dirname(resolve(inputPath)));
  if (candidate === null) return { render: { scale: null, border: null }, lint: emptyLint(), path: null };
  if (!existsSync(candidate)) throw new Error(`${candidate}: no such config file`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(candidate, "utf8"));
  } catch (error) {
    throw new Error(`${candidate} is not valid JSON: ${error.message}`);
  }
  return {
    render: renderSection(candidate, parsed.render ?? {}),
    lint: lintSection(candidate, parsed.lint ?? {}),
    path: candidate,
  };
}

/** Walks up from `dir` to the first directory holding a config file, or null. */
export function findConfig(dir) {
  let current = resolve(dir);
  while (true) {
    const candidate = join(current, CONFIG_FILE);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function emptyLint() {
  return { labelFormat: null, verbs: null, subjects: null, codeLabels: null, palette: null, files: [] };
}

/**
 * The lint vocabulary that applies to one diagram: the config's top-level
 * values, overridden by the first `lint.files` entry whose `match` glob
 * matches the diagram's path relative to the config file. With no config
 * path, the top-level values apply as they are.
 */
export function lintVocabularyFor(config, inputPath) {
  const base = { labelFormat: config.lint.labelFormat, verbs: config.lint.verbs, subjects: config.lint.subjects, codeLabels: config.lint.codeLabels };
  if (config.path === null) return { ...base, match: null };
  const rel = relative(dirname(config.path), resolve(inputPath)).split(sep).join("/");
  const entry = config.lint.files.find((f) => f.regex.test(rel));
  if (!entry) return { ...base, match: null };
  const out = { ...base, match: entry.match };
  for (const key of ["labelFormat", "verbs", "subjects", "codeLabels"]) {
    if (entry[key] !== null) out[key] = entry[key];
  }
  return out;
}

/** A glob with `*` (one segment) and `**` (any depth) as a regular expression over slash paths. */
export function globToRegex(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i];
    if (ch === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (glob[i + 1] === "/") i += 1;
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function renderSection(path, render) {
  for (const key of ["scale", "border"]) {
    if (render[key] !== undefined && typeof render[key] !== "number") {
      throw new Error(`${path}: render.${key} must be a number`);
    }
  }
  return { scale: render.scale ?? null, border: render.border ?? null };
}

function lintSection(path, lint) {
  const out = { ...emptyLint(), ...vocabulary(path, lint, "lint") };
  if (lint.files !== undefined) {
    if (!Array.isArray(lint.files)) throw new Error(`${path}: lint.files must be an array of { match, ... } entries`);
    out.files = lint.files.map((entry, i) => {
      const where = `lint.files[${i}]`;
      if (typeof entry !== "object" || entry === null || typeof entry.match !== "string" || entry.match.trim() === "") {
        throw new Error(`${path}: ${where}.match must be a glob relative to the config file`);
      }
      return { match: entry.match, regex: globToRegex(entry.match), ...vocabulary(path, entry, where) };
    });
  }
  if (lint.palette !== undefined) {
    if (typeof lint.palette !== "string" || lint.palette.trim() === "") {
      throw new Error(`${path}: lint.palette must be a path relative to the config file`);
    }
    // Resolved against the config file, so every reader gets one spelling of
    // the palette whatever directory it ran from.
    out.palette = resolve(dirname(path), lint.palette);
  }
  return out;
}

/** The validated vocabulary keys of a lint section or a `lint.files` entry, nulls for the absent ones. */
function vocabulary(path, section, where) {
  const out = { labelFormat: null, verbs: null, subjects: null, codeLabels: null };
  if (section.labelFormat !== undefined) {
    if (!LABEL_FORMATS.includes(section.labelFormat)) {
      throw new Error(`${path}: ${where}.labelFormat must be one of ${LABEL_FORMATS.join(", ")}`);
    }
    out.labelFormat = section.labelFormat;
  }
  if (section.codeLabels !== undefined) {
    if (!CODE_LABEL_MODES.includes(section.codeLabels)) {
      throw new Error(`${path}: ${where}.codeLabels must be one of ${CODE_LABEL_MODES.join(", ")}`);
    }
    out.codeLabels = section.codeLabels;
  }
  for (const key of ["verbs", "subjects"]) {
    if (section[key] === undefined) continue;
    if (!Array.isArray(section[key]) || section[key].some((v) => typeof v !== "string" || v.trim() === "")) {
      throw new Error(`${path}: ${where}.${key} must be an array of non-empty strings`);
    }
    out[key] = [...section[key]];
  }
  return out;
}
