import { readdirSync, existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { loadConfig, findConfig, lintVocabularyFor, CONFIG_FILE } from "./config.js";
import { extractMxfile, uncompressMxfile } from "./extract.js";
import { lint, parseCells } from "./lint.js";
import { comparePair } from "./pair.js";
import { predictedExportSize, EXPORT_CANVAS_LIMIT } from "./measure.js";
import { pngSize } from "./png.js";

/**
 * The lint options one diagram gets from a config: the vocabulary of the
 * matching `lint.files` entry over the top-level values, and the palette's
 * styles, read from `palette` when given and from the config's palette
 * otherwise. Throws when the palette file is missing.
 */
export function lintOptionsFor(config, inputPath, { palette = null } = {}) {
  const vocab = lintVocabularyFor(config, inputPath);
  const out = {};
  for (const key of ["labelFormat", "verbs", "subjects", "codeLabels"]) {
    if (vocab[key] !== null) out[key] = vocab[key];
  }
  const palettePath = palette ?? config.lint.palette;
  if (palettePath !== null) {
    if (!existsSync(palettePath)) {
      throw new Error(`${palette !== null ? "--palette" : `${config.path}: lint.palette`} names ${palettePath}, which does not exist`);
    }
    out.paletteStyles = paletteStyles(uncompressMxfile(readFileSync(palettePath, "utf8")));
  }
  return { options: out, match: vocab.match };
}

/** The project style guide every diagram project commits, relative to the config file. */
export const PROJECT_GUIDE = join("docs", "diagramming.md");

/** Directories the diagram walk never enters. */
const SKIPPED_DIRS = new Set(["node_modules", ".git"]);

/**
 * Checks a directory tree against the project layout the style guide
 * requires: a config file at or above it, a palette that exists and lints
 * with no errors, the project style guide beside the config, and a rendered
 * sibling for every `.drawio` that still carries its source's model. Each
 * assertion is one line, `ok` or `FAIL`, and `failures` counts the latter.
 *
 * @param dir - The directory whose diagrams are checked, recursively.
 * @returns lines - One line per assertion, and failures - how many failed.
 */
export function checkProject(dir) {
  const root = resolve(dir);
  const lines = [];
  let failures = 0;
  const assertion = (ok, text) => {
    lines.push(`${ok ? "ok  " : "FAIL"} ${text}`);
    if (!ok) failures += 1;
  };

  if (!existsSync(root) || !statSync(root).isDirectory()) {
    assertion(false, `${root} is not a directory`);
    return { lines, failures };
  }

  const configPath = findConfig(root);
  assertion(configPath !== null, configPath === null ? `no ${CONFIG_FILE} at or above ${root}` : `config ${configPath}`);
  if (configPath === null) return { lines, failures };

  let config;
  try {
    config = loadConfig(join(root, "x.drawio"));
    assertion(true, `config parses (render scale ${config.render.scale ?? "default"}, border ${config.render.border ?? "default"})`);
  } catch (error) {
    assertion(false, `config does not parse: ${error.message}`);
    return { lines, failures };
  }

  const projectRoot = dirname(configPath);
  const guide = join(projectRoot, PROJECT_GUIDE);
  assertion(existsSync(guide), existsSync(guide) ? `style guide ${guide}` : `style guide ${guide} is missing`);

  const palette = config.lint.palette;
  if (palette === null) {
    assertion(false, `config sets no lint.palette`);
  } else if (!existsSync(palette)) {
    assertion(false, `palette ${palette} is missing`);
  } else {
    const report = lint(uncompressMxfile(readFileSync(palette, "utf8")));
    assertion(
      report.errors.length === 0,
      `palette ${palette} lints with ${report.errors.length} error(s), ${report.warnings.length} warning(s)`,
    );
  }

  const sources = diagramsUnder(root);
  assertion(sources.length > 0, sources.length > 0 ? `${sources.length} diagram source(s) under ${root}` : `no .drawio under ${root}, nothing to check`);
  for (const source of sources) {
    const sibling = `${source}.png`;
    const name = relative(root, source);
    // Every source is linted with the vocabulary its path gets, so a diagram
    // that fails its own rules cannot pass the layout check on freshness alone.
    try {
      const { options } = lintOptionsFor(config, source);
      const report = lint(uncompressMxfile(readFileSync(source, "utf8")), options);
      assertion(report.errors.length === 0, `${name}: lints with ${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
    } catch (error) {
      assertion(false, `${name}: ${error.message}`);
    }
    if (!existsSync(sibling)) {
      assertion(false, `${name}: rendered sibling ${relative(root, sibling)} is missing`);
      continue;
    }
    let verdict;
    try {
      const sourceXml = uncompressMxfile(readFileSync(source, "utf8"));
      const png = readFileSync(sibling);
      verdict = pairVerdict(sourceXml, png, { scale: config.render.scale ?? 3, border: config.render.border ?? 10 });
    } catch (error) {
      assertion(false, `${name}: ${error.message}`);
      continue;
    }
    assertion(verdict.fresh, `${name}: ${verdict.summary}`);
  }
  return { lines, failures };
}

/**
 * Whether a rendered sibling is fresh: it carries the source's model (see
 * {@link comparePair}) and its pixel size is the size the model predicts at
 * the render settings, so a PNG the exporter clamped to its canvas limit reads
 * as stale.
 */
export function pairVerdict(sourceXml, pngBuffer, { scale, border }) {
  const differences = comparePair(sourceXml, extractMxfile(pngBuffer));
  if (differences.length > 0) {
    return { fresh: false, differences, summary: `rendered sibling is stale (${differences.slice(0, 3).join("; ")}${differences.length > 3 ? "; ..." : ""})` };
  }
  const predicted = predictedExportSize(sourceXml, { scale, border });
  const actual = pngSize(pngBuffer);
  // The exporter clamps the long side to exactly its canvas limit, so a PNG
  // sitting on the limit, or a model that predicts past it, is a clamped pair.
  const atLimit = actual.width === EXPORT_CANVAS_LIMIT || actual.height === EXPORT_CANVAS_LIMIT;
  if (predicted.clamped || atLimit) {
    return {
      fresh: false, differences,
      summary: `rendered sibling is clamped: PNG is ${actual.width}x${actual.height}px but the model predicts ${predicted.width}x${predicted.height}px at scale ${scale}, over the exporter's ${EXPORT_CANVAS_LIMIT}px canvas limit (render.scale ${predicted.fittingScale} would fit)`,
    };
  }
  return { fresh: true, differences, summary: "rendered sibling is fresh" };
}

/** Every `.drawio` under `dir`, depth first, skipping dependency and VCS folders. */
export function diagramsUnder(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith(".")) out.push(...diagramsUnder(join(dir, entry.name)));
    } else if (/\.drawio$/i.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out.sort();
}

/** The style families of every styled cell in a palette file. */
export function paletteStyles(xml) {
  return [...parseCells(xml).values()].filter((c) => c.attrs.style).map((c) => c.attrs.style);
}
