#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { resolve } from "node:path";
import { Command, Option } from "commander";
import { extractMxfile, uncompressMxfile, hasCompressedDiagram, elideImagePayloads, decodeNumericEntities } from "./extract.js";
import { pngSize } from "./png.js";
import { measure, calibrate, predictedExportSize, ICON_GAP_FLAG, EXPORT_CANVAS_LIMIT } from "./measure.js";
import { renderDiagram, selectPage } from "./render.js";
import { doctor } from "./doctor.js";
import { installAssets } from "./install-assets.js";
import { loadConfig } from "./config.js";
import { lint } from "./lint.js";
import { cellsReport, cellXml, stylesReport } from "./cells.js";
import { setGeometry, setWaypoints, setLabelOffset, verifyEdit } from "./edit.js";
import { diffCells, subsetCells } from "./diff.js";
import { setCurated, isCurated, curatedBanner, guardDiff } from "./curate.js";
import { comparePair } from "./pair.js";
import { checkProject, lintOptionsFor as lintOptionsFromConfig, pairVerdict } from "./project.js";
import { pinnedPolyline, labelAnchor, estimateLabelBox, parseCells } from "./lint.js";
import { PNG } from "pngjs";

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * A command whose parse failures leave by the same door as a verb's own
 * failures: the bare message on stderr and exit 1. A missing positional prints
 * the command's help, which is the shape of the invocation the reader needs.
 */
class DrawioCommand extends Command {
  createCommand(name) {
    return new DrawioCommand(name);
  }

  error(message) {
    fail(message.replace(/^error: /, ""));
  }

  optionMissingArgument(option) {
    fail(option.missingValueMessage ?? `option '${option.flags}' argument missing`);
  }

  unknownOption(flag) {
    fail(`unexpected argument: ${flag}`);
  }

  _excessArguments(receivedArgs) {
    fail(`unexpected argument: ${receivedArgs[this.registeredArguments.length]}`);
  }

  missingArgument() {
    this.help({ error: true });
  }
}

/**
 * An option taking a value, carrying the message it prints when the value is
 * absent. Commander detects the absence before any parser runs, so the message
 * belongs on the option itself.
 */
function valueOption(flags, description, missingValueMessage, parse) {
  const option = new Option(flags, description);
  option.missingValueMessage = missingValueMessage;
  if (parse) option.argParser(parse);
  return option;
}

/**
 * Collects a repeatable cell id. A flag mistaken for an id measures garbage
 * silently, so an id argument may never begin with a dash.
 */
function collectId(flag) {
  return (value, previous) => {
    if (value.startsWith("-")) fail(`${flag} requires a cell id (got ${value})`);
    return [...(previous ?? []), value];
  };
}

/** Parses a number, failing when the text is not one. */
function finiteNumber(flag) {
  return (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) fail(`${flag} requires a number`);
    return parsed;
  };
}

/**
 * The scale a render used, shared with measure, which reads that render back.
 * An unvalidated value would reach measure as NaN, which its wrong-scale guard
 * cannot catch: every comparison against NaN is false.
 */
function scaleOption(description) {
  return valueOption("--scale <n>", description, "--scale requires a number", (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) fail("--scale must be a positive number");
    return parsed;
  });
}

/** The border partner of scaleOption, on the same two verbs. */
function borderOption(description) {
  return valueOption("--border <n>", description, "--border requires a number", (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) fail("--border must be a non-negative number");
    return parsed;
  });
}

function writeOutput(path, data) {
  // Write-then-rename, so an observer (editor, file watcher) never sees a torn file.
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, data);
  renameSync(temp, path);
  console.log(path);
}

/** Strips a trailing .png or .svg, then guarantees a .drawio suffix. */
function defaultExtractOutput(input) {
  const stripped = input.replace(/\.(png|svg)$/i, "");
  return stripped.endsWith(".drawio") ? stripped : `${stripped}.drawio`;
}

/** Reads any .drawio/.drawio.png/.drawio.svg into uncompressed mxfile XML. */
function readModel(input) {
  const raw = readFileSync(input);
  const text = raw.toString("utf8");
  return text.includes("<mxfile") && !(raw[0] === 0x89 && raw[1] === 0x50)
    ? uncompressMxfile(text)
    : extractMxfile(raw);
}

function runExtract(input, options) {
  const output = options.o ?? null;
  let xml = readModel(input);
  // Name what was extracted, so a wrong input file (a scratch copy a sibling
  // process overwrote, a stale path) is visible immediately. A single-page
  // file whose page name disagrees with its basename gets a louder line.
  const pages = [...xml.matchAll(/<diagram\b[^>]*?\sname="([^"]*)"/g)].map((m) => m[1]);
  if (pages.length > 0) {
    console.error(`extract: diagram name(s): ${pages.join(", ")}`);
    const base = input.replace(/\.(png|svg)$/i, "").replace(/\.drawio$/i, "").split("/").pop();
    if (pages.length === 1 && pages[0] !== base) {
      console.error(`extract: note page name "${pages[0]}" differs from the file's basename "${base}": confirm this is the file you meant`);
    }
  }
  if (options.elideImages) xml = elideImagePayloads(xml);
  if (options.decodeEntities) xml = decodeNumericEntities(xml);
  if (options.elideImages && output === null) {
    // An elided model no longer renders, so it never lands on the default
    // path where it could shadow (or overwrite) the real file.
    console.log(xml);
    return;
  }
  const target = output ?? defaultExtractOutput(input);
  // Two spellings (a "./" segment, "..", a relative path) name one file, so
  // the identity this guard needs is between resolved paths.
  if (options.elideImages && resolve(target) === resolve(input)) {
    fail("refusing to overwrite the input with an elided (non-rendering) model");
  }
  // The default target is the sibling .drawio, which for a rendered pair is
  // the source of truth, and extracted XML is the webapp's re-serialisation
  // of the model, not that file's original bytes.
  if (existsSync(target) && !options.force) {
    fail(
      `refusing to overwrite ${target}: extracted XML is a re-serialisation, not the file's original bytes. Write elsewhere with -o <path>, or overwrite with --force.`,
    );
  }
  writeOutput(target, xml);
}

function runMeasure(input, options) {
  const fitIds = options.fit ?? [];
  const gapIds = options.gaps ?? [];
  const cellIds = [...(options.cell ?? [])];
  const affine = options.affine === true;
  const iconGaps = options.iconGaps === true;
  if (options.minIconGap !== undefined && !iconGaps) {
    fail("--min-icon-gap only tunes --icon-gaps: add --icon-gaps, or drop the flag");
  }
  // A fit is a measurement plus a sizing verdict, so its cell is measured
  // whether or not --cell also names it.
  for (const id of fitIds) if (!cellIds.includes(id)) cellIds.push(id);
  if (cellIds.length === 0 && gapIds.length === 0 && !affine && !iconGaps) {
    fail("measure needs at least one --cell <id>, --fit <id> or --gaps <id>, --icon-gaps for the sweep, or --affine for the mapping alone");
  }
  const config = loadConfig(input);
  if (config.path !== null && (options.scale === undefined || options.border === undefined)) {
    console.error(`config: ${config.path}`);
  }
  const scale = options.scale ?? config.render.scale ?? 3;
  const border = options.border ?? config.render.border ?? 10;
  const raw = readFileSync(input);
  const xml = extractMxfile(raw);
  const report = measure(raw, xml, {
    cellIds, fitIds, gapIds, affine, scale, border,
    quietCalibration: options.quietCalibration === true,
    iconGaps, minIconGap: options.minIconGap ?? 8,
  });
  console.log(report);
  // A flagged icon gap is a style-guide violation: the report still prints in
  // full, and the exit code makes the sweep scriptable as a gate.
  if (iconGaps && report.includes(ICON_GAP_FLAG)) process.exitCode = 1;
}

/** Strips render input suffixes down to the base name shared by all outputs. */
function renderBase(input) {
  return input.replace(/\.(png|svg)$/i, "").replace(/\.drawio$/i, "");
}

async function runRender(input, options) {
  if (options.force) {
    fail("render always overwrites its derived outputs, no flag needed: drop --force");
  }
  let png = options.png ?? null;
  const svg = options.svg ?? null;
  if (png === null && svg === null) png = true;

  // Precedence: explicit flag, then the nearest drawio.config.json, then built-in default.
  const config = loadConfig(input);
  if (config.path !== null && (options.scale === undefined || options.border === undefined)) {
    console.error(`config: ${config.path}`);
  }
  const scale = options.scale ?? config.render.scale ?? 3;
  const border = options.border ?? config.render.border ?? 10;

  const raw = readFileSync(input);
  let xml = /\.(png|svg)$/i.test(input) ? extractMxfile(raw) : raw.toString("utf8");
  if (options.page !== undefined) xml = selectPage(xml, options.page);

  const base = renderBase(input);
  const formats = [];
  if (png !== null) formats.push("xmlpng");
  if (svg !== null) formats.push("xmlsvg");
  // The exporter clamps the long side to its canvas limit and says nothing, so
  // the prediction refuses first and the PNG's own size is checked after.
  const predicted = predictedExportSize(uncompressMxfile(xml), { scale, border });
  if (png !== null && predicted.clamped) {
    fail(
      `render refused: the model predicts ${predicted.width}x${predicted.height}px at scale ${scale}, over the ` +
        `exporter's ${EXPORT_CANVAS_LIMIT}px canvas limit, and the exporter would clamp it silently. ` +
        `Set render.scale to ${predicted.fittingScale} or lower in drawio.config.json, or split the diagram.`,
    );
  }
  const results = await renderDiagram(xml, { formats, scale, border, webapp: options.webapp });
  if (png !== null) {
    const size = pngSize(Buffer.from(results.xmlpng));
    if (size.width === EXPORT_CANVAS_LIMIT || size.height === EXPORT_CANVAS_LIMIT) {
      fail(`render refused: the exporter clamped the PNG to ${size.width}x${size.height}px (predicted ${predicted.width}x${predicted.height}px), nothing was written`);
    }
  }
  const cellCount = (text) => (String(text).match(/<mxCell[\s>]/g) ?? []).length;
  const inputCells = cellCount(xml);
  for (const format of formats) {
    const exported = cellCount(extractMxfile(Buffer.from(results[format])));
    if (exported < inputCells) {
      fail(
        `render loaded ${exported} of ${inputCells} cells (${format}): the webapp rejected the ` +
          `input silently. Known causes: single-quoted XML attributes, or a cell id that ` +
          `collides with a webapp builtin (e.g. id="map"). Fix the source, nothing was written.`,
      );
    }
  }
  if (png !== null) {
    writeOutput(png === true ? `${base}.drawio.png` : png, results.xmlpng, true);
  }
  if (svg !== null) {
    writeOutput(svg === true ? `${base}.drawio.svg` : svg, results.xmlsvg, true);
  }
}

/**
 * Reads a diagram as its stored text: a .drawio's own bytes, or the model a
 * rendered pair embeds. Nothing is re-serialised, so a slice of the result is
 * a slice of the file.
 */
function readStoredXml(input) {
  const raw = readFileSync(input);
  if (/\.(png|svg)$/i.test(input)) return extractMxfile(raw);
  assertDrawioSource(input, raw);
  return raw.toString("utf8");
}

/**
 * Refuses a `.drawio` whose bytes are an export (an SVG or a PNG saved under
 * the source's name). Such a file holds no stored XML, and a reader that
 * inspected it as one would find zero cells and pass.
 */
function assertDrawioSource(input, raw) {
  const isPng = raw.length >= 8 && raw[0] === 0x89 && raw[1] === 0x50;
  const isSvg = /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<svg\b/i.test(raw.subarray(0, 512).toString("utf8"));
  if (isPng || isSvg) {
    fail(
      `${input} is ${isPng ? "a PNG" : "an SVG"} export saved under a .drawio name, not draw.io source XML: ` +
        `rename it to .drawio.${isPng ? "png" : "svg"}, or run extract on it to recover the source`,
    );
  }
}

/**
 * Reads a diagram for a report that reads the model rather than the file's
 * bytes. The desktop app saves a .drawio with its pages deflated, and the
 * stored text of such a file carries no cells at all, so every reading report
 * expands the payload first rather than inspecting nothing and passing.
 */
function readModelXml(input) {
  return uncompressMxfile(readStoredXml(input));
}

function runCells(input, options) {
  const full = options.full === true;
  const elide = options.elideImages === true;
  if (options.xml === undefined) {
    if (elide) fail("--elide-images belongs to cells --xml <id>: the cells table always elides image payloads");
    const xml = readModelXml(input);
    const banner = curatedBanner(xml);
    if (banner) console.error(banner);
    console.log(cellsReport(xml, { full }));
    return;
  }
  if (full) fail("--full and --xml are different reports: --xml prints one cell's source bytes, never truncated");
  const stored = readStoredXml(input);
  // --xml prints the file's own bytes, and a compressed page has no bytes to
  // slice: uncompressing would print text that appears nowhere in the file.
  if (hasCompressedDiagram(stored)) {
    fail(`compressed model: run extract first, then slice the uncompressed file, since --xml prints ${input}'s own bytes and this page holds none`);
  }
  console.log(cellXml(stored, options.xml, { elideImages: elide }));
}

/**
 * The lint options a config supplies: the repository's label vocabulary and
 * its palette's styles. `--no-config` leaves every one unset, `--config`
 * names the file, and otherwise the nearest config above the input applies.
 */
function lintOptionsFor(input, options) {
  const palette = options.palette ?? null;
  if (options.config === false) {
    const config = loadConfig(input, null);
    const empty = { ...config, lint: { ...config.lint, palette: null, files: [], labelFormat: null, verbs: null, subjects: null, codeLabels: null }, path: null };
    return { ...lintOptionsFromConfig(empty, input, { palette }), path: null };
  }
  const config = loadConfig(input, typeof options.config === "string" ? options.config : null);
  return { ...lintOptionsFromConfig(config, input, { palette }), path: config.path };
}

function runLint(inputs, options) {
  let failing = 0;
  const announced = new Set();
  for (const input of inputs) {
    if (inputs.length > 1) console.log(`== ${input}`);
    const { options: lintOptions, path, match } = lintOptionsFor(input, options);
    if (path !== null && !announced.has(path)) {
      console.error(`config: ${path}`);
      announced.add(path);
    }
    if (match !== null) console.error(`config: lint.files entry "${match}" applies to ${input}`);
    const model = readModelXml(input);
    const banner = curatedBanner(model);
    if (banner) console.error(banner);
    const { errors, warnings, notes } = lint(model, lintOptions);
    for (const n of notes) console.error(`note: ${n}`);
    if (banner && notes.length + warnings.length + errors.length > 0) {
      console.error(
        "curated: findings above that your edit did not introduce are the curator's decisions: report them, never fix them unbidden",
      );
    }
    for (const w of warnings) console.error(`warning: ${w}`);
    for (const e of errors) console.error(`error: ${e}`);
    failing += errors.length + (options.strict ? warnings.length : 0);
    console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);
  }
  if (failing > 0) process.exit(1);
}

function runCheckPair(inputs) {
  let stale = 0;
  for (const input of inputs) {
    if (/\.(png|svg)$/i.test(input)) fail(`check-pair takes the .drawio source, and ${input} is a render`);
    const sibling = `${input}.png`;
    if (!existsSync(sibling)) {
      console.log(`${input}: rendered sibling ${sibling} is missing`);
      stale += 1;
      continue;
    }
    const config = loadConfig(input);
    const verdict = pairVerdict(readModelXml(input), readFileSync(sibling), {
      scale: config.render.scale ?? 3, border: config.render.border ?? 10,
    });
    if (verdict.fresh) {
      console.log(`${input}: rendered sibling is fresh`);
      continue;
    }
    stale += 1;
    console.log(`${input}: ${verdict.summary.replace("rendered sibling is stale", "rendered sibling is STALE, re-render the pair")}`);
    for (const line of verdict.differences) console.log(`  ${line}`);
  }
  if (stale > 0) process.exit(1);
}

function runCheckProject(dir) {
  const { lines, failures } = checkProject(dir);
  for (const line of lines) console.log(line);
  console.log(`check-project: ${failures} failure(s)`);
  if (failures > 0) process.exit(1);
}

/** Reads a .drawio for in-place editing, refusing rendered inputs. */
function readEditable(input) {
  if (/\.(png|svg)$/i.test(input)) {
    fail("editing verbs write the .drawio source in place: edit the source, then re-render the pair");
  }
  const raw = readFileSync(input);
  assertDrawioSource(input, raw);
  return raw.toString("utf8");
}

function finishEdit(input, edited, id, expect) {
  verifyEdit(edited, id, expect);
  writeOutput(input, edited);
  console.error("edited in place: re-render the pair before committing");
}

function runCurate(input, options) {
  const xml = readEditable(input);
  if (hasCompressedDiagram(xml)) {
    fail("compressed model: run extract first, then curate the uncompressed file");
  }
  const on = options.off !== true;
  const edited = setCurated(xml, on);
  if (edited === xml) {
    console.log(on ? "already curated, nothing to do" : "not curated, nothing to remove");
    return;
  }
  if (isCurated(edited) !== on) fail("verification failed: the marker did not land, nothing was written");
  writeOutput(input, edited);
  console.log(
    on
      ? "curated: agents now change only what a task names on this diagram (re-render the pair so the PNG's embedded model carries the marker)"
      : "curation removed (re-render the pair)",
  );
}

function runGuardDiff(baseline, edited, options) {
  const { lines, violations } = guardDiff(readModelXml(baseline), readModelXml(edited), options.allow ?? []);
  for (const line of lines) console.log(line);
  if (violations > 0) process.exit(1);
}

/**
 * A cell id positional. An id may never begin with a dash: the invocation shape
 * is what the reader got wrong, so the command's help is the answer.
 */
function requirePlainId(command, id) {
  if (id.startsWith("-")) command.help({ error: true });
}

function runSetGeometry(input, id, options, command) {
  requirePlainId(command, id);
  const geo = {};
  for (const key of ["x", "y", "width", "height"]) {
    if (options[key] !== undefined) geo[key] = options[key];
  }
  if (Object.keys(geo).length === 0) fail("set-geometry needs at least one of --x/--y/--width/--height");
  const edited = setGeometry(readEditable(input), id, geo);
  finishEdit(input, edited, id, { geo });
}

function runSetWaypoints(input, id, list, options, command) {
  requirePlainId(command, id);
  const points = list.trim() === "" ? [] : list.trim().split(/\s+/).map((pair) => {
    const m = /^(-?[\d.]+),(-?[\d.]+)$/.exec(pair);
    if (!m) fail(`waypoint "${pair}" is not x,y`);
    return { x: Number(m[1]), y: Number(m[2]) };
  });
  const edited = setWaypoints(readEditable(input), id, points);
  finishEdit(input, edited, id, { points });
}

function runSetLabelOffset(input, id, dxRaw, dyRaw, options, command) {
  requirePlainId(command, id);
  const dx = Number(dxRaw), dy = Number(dyRaw);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) fail("set-label-offset requires numeric dx and dy");
  const edited = setLabelOffset(readEditable(input), id, dx, dy);
  finishEdit(input, edited, id, { offset: { x: dx, y: dy } });
}

function runDiffCells(a, b, options) {
  if (options.subset) {
    const { lines, violations } = subsetCells(readModel(a), readModel(b));
    for (const line of lines) console.log(line);
    if (violations > 0) process.exit(1);
    return;
  }
  const lines = diffCells(readModel(a), readModel(b));
  for (const line of lines) console.log(line);
  console.log(lines.length === 0 ? "cells match (ids, values, styles)" : `${lines.length} difference line(s)`);
  if (lines.length > 0) process.exit(1);
}

/**
 * Seats an edge label on the midpoint of one pinned segment of its edge: the
 * label's relative position becomes that point's arc-length fraction mapped
 * to -1..1, and its offset centres the estimated text box on the run
 * (`align=left` hangs the text to the right of the anchor, so it gets minus
 * half the width, `align=right` plus half, `align=center` nothing).
 */
function runSeatLabel(input, id, options, command) {
  requirePlainId(command, id);
  const xml = readEditable(input);
  if (hasCompressedDiagram(xml)) fail("compressed model: run extract first, then seat labels in the uncompressed file");
  const cells = parseCells(xml);
  const label = cells.get(id);
  if (!label) fail(`no cell with id ${id}`);
  const edge = cells.get(label.attrs.parent);
  if (edge?.attrs.edge !== "1") fail(`${id} is not an edge label: its parent is not an edge`);
  const res = pinnedPolyline(cells, edge);
  if (!res.pts) fail(`edge ${edge.id} has no pinned polyline (${res.missing ? `missing ${res.missing}` : res.nogeo ? "a terminal without geometry" : "floating connection points"}), pin exitX/exitY and entryX/entryY first`);
  const segments = res.pts.length - 1;
  const k = options.segment;
  if (k < 1 || k > segments) fail(`--segment ${k} is out of range: edge ${edge.id} has ${segments} segment(s)`);
  const lengths = [];
  let arc = 0;
  for (let i = 0; i < segments; i += 1) {
    const len = Math.abs(res.pts[i].x - res.pts[i + 1].x) + Math.abs(res.pts[i].y - res.pts[i + 1].y);
    lengths.push(len);
    arc += len;
  }
  if (arc === 0) fail(`edge ${edge.id} has no length to seat a label on`);
  const before = lengths.slice(0, k - 1).reduce((a, b) => a + b, 0);
  const fraction = (before + lengths[k - 1] / 2) / arc;
  const position = Math.round((fraction * 2 - 1) * 10000) / 10000;
  const est = estimateLabelBox(label.attrs.value);
  const align = label.style.align ?? "center";
  const dx = align === "left" ? -Math.round(est.w / 2) : align === "right" ? Math.round(est.w / 2) : 0;
  const dy = (label.style.verticalAlign ?? null) === "middle" ? 0 : -Math.round(est.h / 2 + 4);
  let edited = setGeometry(xml, id, { x: position });
  edited = setLabelOffset(edited, id, dx, dy);
  verifyEdit(edited, id, { offset: { x: dx, y: dy } });
  const mid = labelAnchor(res.pts, position, null);
  writeOutput(input, edited);
  console.error(
    `seated ${id} on segment ${k} of ${segments} of edge ${edge.id}: position ${position} (midpoint (${Math.round(mid.x)},${Math.round(mid.y)})), ` +
      `offset ${dx},${dy} for align=${align}; re-render the pair and run lint`,
  );
}

/**
 * Sizes a box to its rendered text under the uniform padding rule, applying
 * the box `measure --fit` reports. The rendered sibling must be fresh, since
 * the ink is measured on it.
 */
function runFitBox(input, id, options, command) {
  requirePlainId(command, id);
  const xml = readEditable(input);
  const sibling = `${input}.png`;
  if (!existsSync(sibling)) fail(`fit-box measures the rendered sibling, and ${sibling} is missing: render the pair first`);
  const config = loadConfig(input);
  const scale = options.scale ?? config.render.scale ?? 3;
  const border = options.border ?? config.render.border ?? 10;
  const png = readFileSync(sibling);
  const verdict = pairVerdict(uncompressMxfile(xml), png, { scale, border });
  if (!verdict.fresh) fail(`fit-box refuses a stale sibling: ${verdict.summary}. Render the pair first`);
  const collect = { fits: [] };
  const report = measure(png, uncompressMxfile(xml), { cellIds: [id], fitIds: [id], scale, border, quietCalibration: true, collect });
  const fit = collect.fits.find((f) => f.id === id);
  if (!fit) fail(`fit-box found no text ink to size ${id} to:\n${report}`);
  const edited = setGeometry(xml, id, { width: fit.impliedW, height: fit.impliedH });
  verifyEdit(edited, id, { geo: { width: fit.impliedW, height: fit.impliedH } });
  writeOutput(input, edited);
  console.error(`fit ${id} to ${fit.impliedW}x${fit.impliedH}u; re-render the pair`);
}

/**
 * Crops a region of a rendered PNG given in model units, mapped to pixels
 * through the same calibration `measure` uses. A residual larger than the
 * region would move the crop off its target, so that is the one refusal.
 */
function runCrop(input, options) {
  const m = /^(-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+)$/.exec(options.region ?? "");
  if (!m) fail("--region takes x,y,w,h in model units");
  const [x, y, w, h] = m.slice(1).map(Number);
  if (w <= 0 || h <= 0) fail("--region needs a positive width and height");
  const config = loadConfig(input);
  const scale = options.scale ?? config.render.scale ?? 3;
  const border = options.border ?? config.render.border ?? 10;
  const raw = readFileSync(input);
  const cal = calibrate(raw, extractMxfile(raw), { scale, border, quietCalibration: true });
  if (cal.warningLive && (Math.abs(cal.residualW) > w * scale || Math.abs(cal.residualH) > h * scale)) {
    fail(`crop refused: the calibration residual ${cal.residualW},${cal.residualH}px is larger than the ${w}x${h}u region at scale ${scale}, so the crop could miss it entirely`);
  }
  const tl = cal.toPx(x, y), br = cal.toPx(x + w, y + h);
  const left = Math.max(0, tl.x), top = Math.max(0, tl.y);
  const right = Math.min(cal.img.width, br.x), bottom = Math.min(cal.img.height, br.y);
  if (right <= left || bottom <= top) fail(`crop refused: the region maps outside the PNG (${cal.img.width}x${cal.img.height}px)`);
  const out = new PNG({ width: right - left, height: bottom - top });
  for (let py = top; py < bottom; py += 1) for (let px = left; px < right; px += 1) {
    const [r, g, b, a] = cal.img.at(px, py);
    const at = ((py - top) * out.width + (px - left)) * 4;
    out.data[at] = r; out.data[at + 1] = g; out.data[at + 2] = b; out.data[at + 3] = a;
  }
  const target = options.o ?? input.replace(/\.png$/i, `-crop-${Math.round(x)}-${Math.round(y)}.png`);
  writeOutput(target, PNG.sync.write(out));
  console.error(`cropped ${out.width}x${out.height}px at (${left},${top}) for model region ${x},${y} ${w}x${h}u${cal.warningLive ? ` (error bar ${Math.abs(cal.residualW)},${Math.abs(cal.residualH)}px)` : ""}`);
}

const program = new DrawioCommand()
  .name("drawio-cli")
  .description("Extract, render, lint, measure and edit draw.io diagrams from the command line.");

program
  .command("extract")
  .description("write the embedded model of a diagram out as uncompressed .drawio XML")
  .argument("<input>", "a .drawio, .drawio.png or .drawio.svg file")
  .addOption(valueOption("-o <output>", "the output path, in place of the default sibling .drawio", "-o requires a path"))
  .option("--force", "overwrite the output file when it already exists")
  .option("--elide-images", "replace embedded image payloads with size markers, printing to stdout")
  .option("--decode-entities", "decode numeric character entities such as &#39;")
  .action(runExtract);

program
  .command("render")
  .option("--webapp <path>", "explicit draw.io webapp directory, with no fallback")
  .description("render a diagram to PNG and/or SVG with the model embedded")
  .argument("<input.drawio>", "a .drawio, .drawio.png or .drawio.svg file")
  .option("--png [path]", "write a PNG, at this path when given (the default with neither format)")
  .option("--svg [path]", "write an SVG, at this path when given")
  .addOption(valueOption("--page <name|index>", "render one page of a multi-page file", "--page requires a name or zero-based index"))
  .addOption(scaleOption("export scale, overriding drawio.config.json"))
  .addOption(borderOption("export border, overriding drawio.config.json"))
  .addOption(new Option("--force").hideHelp())
  .action(runRender);

program
  .command("lint")
  .description("verify a diagram's routing, labels and cell values from the XML alone")
  .argument("<input...>", "one or more .drawio, .drawio.png or .drawio.svg files")
  .option("--strict", "fail on warnings as well as errors")
  .addOption(valueOption("--config <path>", "the drawio.config.json to apply, in place of the upward search", "--config requires a path"))
  .option("--no-config", "run the universal checks only, ignoring any drawio.config.json")
  .addOption(valueOption("--palette <path>", "the palette to check style families against, in place of the config's", "--palette requires a path"))
  .action(runLint);

program
  .command("seat-label")
  .description("seat an edge label on the midpoint of one pinned segment of its edge, in place")
  .argument("<input.drawio>", "the .drawio source to edit")
  .argument("<id>", "the label cell to seat")
  .addOption(valueOption("--segment <k>", "the 1-based segment of the edge's pinned polyline to seat on", "--segment requires a segment number", (value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1) fail("--segment must be a positive integer");
    return parsed;
  }).makeOptionMandatory())
  .action(runSeatLabel);

program
  .command("fit-box")
  .description("size a box to its rendered text under the uniform padding rule, from the fresh rendered sibling")
  .argument("<input.drawio>", "the .drawio source to edit")
  .argument("<id>", "the cell to size")
  .addOption(scaleOption("the scale the sibling was rendered at"))
  .addOption(borderOption("the border the sibling was rendered with"))
  .action(runFitBox);

program
  .command("crop")
  .description("crop a region of a rendered PNG given in model units")
  .argument("<input.drawio.png>", "a rendered .drawio.png")
  .addOption(valueOption("--region <x,y,w,h>", "the region in model units", "--region requires x,y,w,h").makeOptionMandatory())
  .addOption(valueOption("-o <output>", "the output path, in place of <input>-crop-<x>-<y>.png", "-o requires a path"))
  .addOption(scaleOption("the scale the PNG was rendered at"))
  .addOption(borderOption("the border the PNG was rendered with"))
  .action(runCrop);

program
  .command("check-pair")
  .description("verify each .drawio's rendered .drawio.png sibling still carries the source's model")
  .argument("<input.drawio...>", "one or more .drawio sources")
  .action(runCheckPair);

program
  .command("check-project")
  .description("verify a directory follows the diagram project layout: config, palette, style guide and fresh pairs")
  .argument("<dir>", "the directory whose diagrams are checked, recursively")
  .action(runCheckProject);

program
  .command("cells")
  .description("print the diagram as a readable cell table, or one cell's source bytes")
  .argument("<input>", "a .drawio, .drawio.png or .drawio.svg file")
  .option("--full", "print untruncated style strings in the table")
  .addOption(valueOption("--xml <id>", "print this cell's element verbatim, in place of the table", "--xml requires a cell id"))
  .option("--elide-images", "replace the printed cell's image payload with a size marker")
  .action(runCells);

program
  .command("styles")
  .description("digest a palette file into a named catalogue of copyable style strings")
  .argument("<input>", "a .drawio, .drawio.png or .drawio.svg file")
  .action((input) => {
    console.log(stylesReport(readModelXml(input)));
  });

program
  .command("measure")
  .description("measure rendered cells against the model embedded in a PNG")
  .argument("<input.drawio.png>", "a rendered .drawio.png")
  .addOption(valueOption("--cell <id>", "measure this cell (repeatable)", "--cell requires a cell id (got nothing)", collectId("--cell")))
  .addOption(valueOption("--fit <id>", "measure this cell and size its box to its ink (repeatable)", "--fit requires a cell id (got nothing)", collectId("--fit")))
  .addOption(valueOption("--gaps <id>", "report this cell's gaps to its neighbours (repeatable)", "--gaps requires a cell id (got nothing)", collectId("--gaps")))
  .option("--affine", "print the model-unit to pixel mapping this calibration implies")
  .option("--icon-gaps", "sweep every labelled box containing an image cell and report the icon-ink-to-glyph gap")
  .addOption(valueOption("--min-icon-gap <n>", "minimum gap in model units the --icon-gaps sweep flags under (default 8)", "--min-icon-gap requires a number", finiteNumber("--min-icon-gap")))
  .option("--quiet-calibration", "drop the calibration line and note, never the warning")
  .addOption(scaleOption("the scale the PNG was rendered at"))
  .addOption(borderOption("the border the PNG was rendered with"))
  .action(runMeasure);

program
  .command("set-geometry")
  .description("set any of x, y, width, height on one cell of a .drawio, in place")
  .argument("<input.drawio>", "the .drawio source to edit")
  .argument("<id>", "the cell to edit")
  .addOption(valueOption("--x <n>", "geometry x", "--x requires a number", finiteNumber("--x")))
  .addOption(valueOption("--y <n>", "geometry y", "--y requires a number", finiteNumber("--y")))
  .addOption(valueOption("--width <n>", "geometry width", "--width requires a number", finiteNumber("--width")))
  .addOption(valueOption("--height <n>", "geometry height", "--height requires a number", finiteNumber("--height")))
  .action(runSetGeometry);

program
  .command("set-waypoints")
  .description("replace an edge's waypoints in a .drawio, in place")
  .argument("<input.drawio>", "the .drawio source to edit")
  .argument("<id>", "the edge to edit")
  .argument("<points>", 'space-separated "x1,y1 x2,y2 ...", or an empty string to clear them')
  .action(runSetWaypoints);

program
  .command("set-label-offset")
  .description("set an edge label's offset point in a .drawio, in place")
  .argument("<input.drawio>", "the .drawio source to edit")
  .argument("<id>", "the label cell to edit")
  .argument("<dx>", "offset x in model units")
  .argument("<dy>", "offset y in model units")
  .action(runSetLabelOffset);

program
  .command("curate")
  .description("mark a .drawio as hand-tidied so agents change only what a task names (idempotent; --off unmarks)")
  .argument("<input.drawio>", "the .drawio source to mark, in place")
  .option("--off", "remove the curation marker")
  .action(runCurate);

program
  .command("guard-diff")
  .description("verify an edit stayed inside its mandate: every changed cell must be on the allow-list")
  .argument("<baseline>", "the model before the edit (.drawio, .drawio.png or .drawio.svg)")
  .argument("<edited>", "the model after the edit")
  .addOption(valueOption("--allow <id>", "cell id permitted to change (repeatable; none means nothing may change)", "--allow requires a cell id (got nothing)", collectId("--allow")))
  .action(runGuardDiff);

program
  .command("diff-cells")
  .description("compare two models cell by cell: ids, values and styles")
  .argument("<a>", "a .drawio, .drawio.png or .drawio.svg file")
  .argument("<b>", "a .drawio, .drawio.png or .drawio.svg file")
  .option("--subset", "prove a is a copy of part of b: shared cells must match, cells only in a are violations")
  .action(runDiffCells);

program
  .command("doctor")
  .description("check webapp assets, the playwright package and its Chromium executable")
  .option("--webapp <path>", "explicit draw.io webapp directory, with no fallback")
  .action(async (options) => {
    process.exit(await doctor(options));
  });

program
  .command("install-assets")
  .description("install pinned standalone draw.io webapp assets locally")
  .option("--archive <path>", "use a downloaded archive, checked against the pinned digest")
  .option("--directory <path>", "asset installation directory")
  .action(installAssets);

program.parseAsync(process.argv).catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
