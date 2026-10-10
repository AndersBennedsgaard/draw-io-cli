import { decodePng } from "./png.js";
import {
  parseCells, pinnedPolyline, labelAnchor, estimateLabelBox, labelBoxFor, modelBounds, isSpecimenEdge,
} from "./lint.js";

function absOrigin(cells, id) {
  let x = 0, y = 0, cur = cells.get(id);
  const seen = new Set();
  while (cur && !seen.has(cur)) {
    seen.add(cur); // a parent cycle in a malformed model must not hang the walk
    if (cur.geo && cur.attrs.vertex === "1") { x += Number(cur.geo.x ?? 0); y += Number(cur.geo.y ?? 0); }
    cur = cells.get(cur.attrs.parent);
  }
  return { x, y };
}

function bbox(cells, c) {
  const o = absOrigin(cells, c.attrs.parent);
  return {
    x: o.x + Number(c.geo.x ?? 0),
    y: o.y + Number(c.geo.y ?? 0),
    w: Number(c.geo.width ?? 0),
    h: Number(c.geo.height ?? 0),
  };
}

const INK = ([r, g, b, a]) => a > 16 && (r < 245 || g < 245 || b < 245);

/** The marker an under-minimum icon-gap line carries, shared with the CLI's exit code. */
export const ICON_GAP_FLAG = "UNDER MINIMUM";

// units: the uniform text padding a box is sized to, left/right and top/bottom.
const FIT_PAD_X = 8;
const FIT_PAD_Y = 6;

/** Renders `mx - origin` readably, so a negative origin reads as an addition. */
function shifted(variable, origin) {
  return origin < 0 ? `(${variable} + ${-origin})` : `(${variable} - ${origin})`;
}

/** Renders `+ origin` readably, so a negative origin reads as a subtraction. */
function added(origin) {
  return origin < 0 ? `- ${-origin}` : `+ ${origin}`;
}

/** Resolves every edge label's estimated box in absolute model space. */
function estimatedLabelBoxes(cells) {
  const out = [];
  for (const c of cells.values()) {
    if (c.attrs.vertex !== "1" || !c.geo) continue;
    const parentEdge = cells.get(c.attrs.parent);
    if (parentEdge?.attrs.edge !== "1") continue;
    const res = pinnedPolyline(cells, parentEdge);
    if (!res.pts) continue;
    const anchor = labelAnchor(res.pts, c.geo.x, c.offset);
    if (!anchor) continue;
    const est = estimateLabelBox(c.attrs.value);
    const raw = labelBoxFor(anchor, est, c.style);
    const box = {
      x: Math.round(raw.x * 10) / 10, y: Math.round(raw.y * 10) / 10,
      w: Math.round(raw.w * 10) / 10, h: Math.round(raw.h * 10) / 10,
    };
    out.push({ cell: c, edge: parentEdge, anchor, est, box });
  }
  return out;
}

/** Parses a style stroke colour to [r,g,b]; the webapp default is black. */
function strokeRgb(style) {
  const hex = style.strokeColor;
  if (hex === undefined || hex === "default") return [0, 0, 0];
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/**
 * The estimated boxes of captions the exporter draws outside their cells: an
 * image cell's value with `verticalLabelPosition` top or bottom renders above
 * or below the image, centred, and extends the export bounds past the geometry.
 */
function captionBoxes(cells) {
  const out = [];
  for (const c of cells.values()) {
    if (c.attrs.vertex !== "1" || !c.geo || !c.attrs.value) continue;
    const position = c.style.verticalLabelPosition;
    if (position !== "top" && position !== "bottom") continue;
    if (cells.get(c.attrs.parent)?.attrs.edge === "1") continue;
    const box = bbox(cells, c);
    const est = estimateLabelBox(c.attrs.value);
    // A caption carries the webapp's label padding on each side, which the
    // bare text estimate does not include.
    const w = est.w + 2 * CAPTION_PAD;
    const x = box.x + box.w / 2 - w / 2;
    const y = position === "top" ? box.y - est.h - CAPTION_GAP : box.y + box.h + CAPTION_GAP;
    out.push({ cell: c, box: { x, y, w, h: est.h } });
  }
  return out;
}

// units: the clearance the webapp leaves between an image and its caption, and the label padding each side of the caption text.
const CAPTION_GAP = 2;
const CAPTION_PAD = 4;
// units: the export slack per axis from strokes straddling their geometry, a
// two-unit stroke's half on each bound.
const STROKE_SLACK = 2;

/**
 * The content bounds the exporter frames: geometry, plus the estimated boxes
 * of edge labels and of image captions, both of which the export includes
 * although neither has committed geometry. `overhangs` names each estimated
 * box that reaches past the geometry, which is what a residual is usually
 * made of.
 */
export function fullBounds(cells) {
  const b = modelBounds(cells);
  const labels = estimatedLabelBoxes(cells);
  const captions = captionBoxes(cells);
  let minX = b.minX, minY = b.minY, maxX = b.maxX, maxY = b.maxY;
  const overhangs = [];
  for (const { cell, box } of [...labels, ...captions]) {
    const over = Math.max(b.minX - box.x, (box.x + box.w) - b.maxX, b.minY - box.y, (box.y + box.h) - b.maxY);
    if (over > 2) overhangs.push(`${cell.id} (~${Math.round(over)}u past the geometry bounds)`);
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  // Which estimated box, if any, sets each full bound: a residual on an axis
  // whose bound is an estimate is the estimate's error, attributed rather
  // than unexplained.
  const estimated = { minX: null, minY: null, maxX: null, maxY: null };
  for (const { cell, box } of [...labels, ...captions]) {
    if (box.x <= b.minX - 0.01 && box.x <= minX + 0.01) estimated.minX = cell.id;
    if (box.y <= b.minY - 0.01 && box.y <= minY + 0.01) estimated.minY = cell.id;
    if (box.x + box.w >= b.maxX + 0.01 && box.x + box.w >= maxX - 0.01) estimated.maxX = cell.id;
    if (box.y + box.h >= b.maxY + 0.01 && box.y + box.h >= maxY - 0.01) estimated.maxY = cell.id;
  }
  return { minX, minY, maxX, maxY, setBy: b.setBy, estimated, overhangs, labels };
}

/** The longest side a PNG export can have: the browser canvas limit the exporter silently clamps to. */
export const EXPORT_CANVAS_LIMIT = 16384;

/**
 * The pixel size an export of this model has at `scale` and `border`, and
 * the largest scale that keeps it inside the canvas limit. A model whose
 * prediction exceeds the limit is clamped by the exporter without a word,
 * so the caller refuses before rendering, or reads a clamped sibling as stale.
 */
export function predictedExportSize(xml, { scale, border }) {
  let bounds;
  try {
    bounds = fullBounds(parseCells(xml));
  } catch {
    // A model with no geometry has no export size, so nothing to clamp.
    return { width: 0, height: 0, clamped: false, fittingScale: scale };
  }
  const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
  const width = Math.round((w + 2 * border) * scale);
  const height = Math.round((h + 2 * border) * scale);
  const fittingScale = Math.floor((EXPORT_CANVAS_LIMIT / Math.max(w, h) - 0) * 100) / 100;
  return { width, height, clamped: width > EXPORT_CANVAS_LIMIT || height > EXPORT_CANVAS_LIMIT, fittingScale: Math.max(0.1, Math.min(fittingScale, scale)) };
}

/**
 * Maps the model embedded in a rendered PNG onto that PNG's pixels. The
 * residual between the predicted and actual size is the error bar on every
 * number read through the mapping: within the render border's slack it is a
 * note, beyond it a WARNING that stays attached to the numbers.
 *
 * @returns The decoded image, the parsed cells, the full bounds, the
 *   prediction and residual, the calibration report lines, `warningLive`,
 *   `toPx` (model point to pixel) and `u` (pixels to rounded model units).
 * @throws When the PNG's size says it was rendered at a different scale.
 */
export function calibrate(pngBuffer, xml, { scale, border, quietCalibration = false }) {
  const img = decodePng(pngBuffer);
  const cells = parseCells(xml);
  const bounds = fullBounds(cells);
  const { minX: fullMinX, minY: fullMinY, maxX: fullMaxX, maxY: fullMaxY, overhangs, labels } = bounds;
  const predictedW = Math.round((fullMaxX - fullMinX + 2 * border) * scale);
  const predictedH = Math.round((fullMaxY - fullMinY + 2 * border) * scale);
  const residualW = img.width - predictedW;
  const residualH = img.height - predictedH;
  // A wrong SCALE multiplies both dimensions by one factor, so two axis
  // ratios that agree and sit far from 1 mean the PNG is a different render:
  // publishing numbers against it would mislead. A one-axis or additive
  // mismatch (a misstated border, overhanging strokes) is a residual for the
  // warning path below, not a scale error.
  const ratioW = img.width / predictedW;
  const ratioH = img.height / predictedH;
  if (Math.abs(ratioW - ratioH) < 0.05 * Math.max(ratioW, ratioH) && (ratioW > 1.2 || ratioW < 0.8)) {
    const impliedScale = (scale * (ratioW + ratioH)) / 2;
    throw new Error(
      `PNG is ${img.width}x${img.height} but scale=${scale} border=${border} predicts ` +
        `${predictedW}x${predictedH}: the PNG appears rendered at scale ~${Math.round(impliedScale * 100) / 100}. ` +
        `Pass the scale it was actually rendered at (--scale), or re-render with the config.`,
    );
  }
  const lines = [];
  if (!quietCalibration) {
    const labelNote = overhangs.length > 0 ? ` (estimated boxes extend the geometry: ${overhangs.join(", ")})` : "";
    lines.push(
      `calibration: scale=${scale} border=${border} content=(${Math.round(fullMinX)},${Math.round(fullMinY)})..(${Math.round(fullMaxX)},${Math.round(fullMaxY)})${labelNote} ` +
        `png=${img.width}x${img.height} predicted=${predictedW}x${predictedH} residual=${residualW},${residualH}px`,
    );
  }
  // A stroke straddles its geometry by half its width, so a 2-unit stroke on
  // each bound of an axis adds two units to the export, and the predicted size
  // rounds to a pixel: that much is slack.
  const slack = STROKE_SLACK * scale + 1;
  let warningLive = false;
  if (Math.abs(residualW) > slack || Math.abs(residualH) > slack) {
    const suspects = `Bounds are set by left=${bounds.setBy.minX} top=${bounds.setBy.minY} right=${bounds.setBy.maxX} ` +
      `bottom=${bounds.setBy.maxY}: check those cells for overhanging strokes`;
    // The export leaves `border` units of slack per side, so a residual within
    // it pushes nothing out of frame. When the bound-setting cells on the
    // offending axes are EDGES, the webapp's habit of padding an edge's
    // bounds beyond its declared polyline explains the residual: known and
    // harmless is a note, not a warning repeated on every invocation.
    const small = Math.max(Math.abs(residualW), Math.abs(residualH)) <= border * scale;
    const isEdge = (id) => cells.get(id)?.attrs.edge === "1";
    // An axis whose bound is an edge (the webapp pads an edge's bounds beyond
    // its polyline) or an estimated label or caption box (a character-count
    // estimate, about a tenth out) has its residual explained.
    const explained = (axisResidual, setBy, estimatedBy) =>
      Math.abs(axisResidual) <= slack || isEdge(setBy) || estimatedBy !== null;
    // A residual on an axis comes from one of its two bounds, so either bound
    // being an edge or an estimate explains that axis.
    const attributed =
      (explained(residualW, bounds.setBy.minX, bounds.estimated.minX) || explained(residualW, bounds.setBy.maxX, bounds.estimated.maxX)) &&
      (explained(residualH, bounds.setBy.minY, bounds.estimated.minY) || explained(residualH, bounds.setBy.maxY, bounds.estimated.maxY));
    // One shift on both axes is what a misstated border produces, which an
    // estimate cannot explain, so it stays a warning unless an edge sets a
    // bound: the webapp pads an edge's bounds evenly, which shifts both axes too.
    const anyEdgeBound = [bounds.setBy.minX, bounds.setBy.maxX, bounds.setBy.minY, bounds.setBy.maxY].some(isEdge);
    const uniformShift = residualW === residualH && Math.abs(residualW) > slack && !anyEdgeBound;
    if (small && attributed && !uniformShift) {
      if (!quietCalibration) {
        const estimates = Object.values(bounds.estimated).filter((id) => id !== null);
        lines.push(
          `calibration: note residual ${residualW},${residualH}px is within the render border ` +
            `(${border}u = ${border * scale}px) and attributed to bound-setting edges or estimated boxes` +
            `${estimates.length > 0 ? ` (${[...new Set(estimates)].join(", ")})` : ""}. ${suspects}`,
        );
      }
    } else {
      warningLive = true;
      lines.push(
        `calibration: WARNING residual exceeds ${slack}px, strokes extend past the estimated ` +
          `content bounds; per-cell numbers below may be off by up to residual/scale units. ` +
          `${uniformShift ? "The same shift on both axes is what a misstated border produces: check --border against the render. " : ""}${suspects}`,
      );
    }
  }
  const shiftX = Math.trunc(residualW / 2);
  const shiftY = Math.trunc(residualH / 2);
  const toPx = (mx, my) => ({
    x: Math.round((mx - fullMinX + border) * scale) + shiftX,
    y: Math.round((my - fullMinY + border) * scale) + shiftY,
  });
  const u = (px) => Math.round((px / scale) * 10) / 10;
  return {
    img, cells, bounds, labels, scale, border,
    predictedW, predictedH, residualW, residualH, shiftX, shiftY, warningLive, lines, toPx, u,
  };
}

/**
 * Measures cells of a rendered .drawio.png against its embedded model.
 * Calibration maps model units to pixels from the FULL content bounds
 * (geometry plus estimated edge-label boxes, labels being the usual reason
 * the export outgrows the geometry) plus the render config's scale and
 * border; the report opens with the calibration residual so measurements
 * carry their own error bar.
 *
 * @param pngBuffer - The rendered PNG's bytes.
 * @param xml - The model embedded in that PNG.
 * @param cellIds - Ids to measure, in report order.
 * @param fitIds - Ids that additionally report the box their measured text ink
 *   implies under the uniform padding rule. Every fit id is measured, so the
 *   caller need not repeat it in `cellIds`.
 * @param gapIds - Container ids whose children's clearances and largest empty
 *   rectangle are reported.
 * @param affine - When true, print the model-unit to pixel mapping per axis in
 *   both directions, taken from this same calibration, with the residual named
 *   as its error bar while a calibration WARNING stands.
 * @param collect - When an object with a `fits` array, every `--fit` verdict
 *   is also pushed there as `{ id, impliedW, impliedH }`, so a caller can apply
 *   the fit without parsing the report.
 * @param iconGaps - When true, sweep every labelled vertex that geometrically
 *   contains an image cell (an icon embedded in an actor box) and report the
 *   clear gap between the icon's rendered ink and the first text glyph, in
 *   model units. A pair under `minIconGap` is flagged with
 *   {@link ICON_GAP_FLAG}; a model with no such pairs reports the sweep as
 *   vacuous rather than green.
 * @param minIconGap - Minimum acceptable icon-ink-to-glyph gap in model units
 *   for the `iconGaps` sweep.
 * @param scale - Render scale the PNG was exported at.
 * @param border - Render border, in model units, the PNG was exported with.
 * @param quietCalibration - When true, drop the calibration line and a demoted
 *   residual note. A residual too large or too vague to attribute still warns:
 *   it is the error bar on every number below it.
 * @returns The report, one cell per line.
 * @throws When the PNG's size is so far off the prediction that it must have
 *   been rendered at a different scale: numbers would be nonsense.
 */
export function measure(pngBuffer, xml, { cellIds, fitIds = [], gapIds = [], affine = false, scale, border, quietCalibration = false, iconGaps = false, minIconGap = 8, collect = null }) {
  const cal = calibrate(pngBuffer, xml, { scale, border, quietCalibration });
  const { img, cells, labels, residualW, residualH, shiftX, shiftY, warningLive, toPx, u } = cal;
  const { minX: fullMinX, minY: fullMinY } = cal.bounds;
  const lines = [...cal.lines];
  if (affine) {
    // The same numbers toPx runs on, written out so a crop of a model region
    // is one substitution rather than a transcription of the calibration line.
    // Under a live warning the residual is the error bar, stated with the mapping.
    const offsetX = border * scale + shiftX;
    const offsetY = border * scale + shiftY;
    if (warningLive) {
      lines.push(
        `affine: error bar ${Math.abs(residualW)},${Math.abs(residualH)}px (the live calibration WARNING above): ` +
          `a pixel read through this mapping may be off by up to that much on its axis`,
      );
    }
    lines.push(
      `affine: offset = border ${border}u * scale ${scale} + residual shift ${shiftX},${shiftY}px ` +
        `(= ${offsetX},${offsetY}px); px rounds to the nearest integer`,
      `affine x: px = ${shifted("mx", fullMinX)} * ${scale} + ${offsetX}`,
      `affine x: mx = (px - ${offsetX}) / ${scale} ${added(fullMinX)}`,
      `affine y: py = ${shifted("my", fullMinY)} * ${scale} + ${offsetY}`,
      `affine y: my = (py - ${offsetY}) / ${scale} ${added(fullMinY)}`,
    );
  }
  // Scans ink inside a model-space box, inset by insetU units per side so a
  // border stroke never counts as ink. Returns null when no ink is found.
  const inkIn = (box, insetU) => {
    const tl = toPx(box.x, box.y);
    const br = toPx(box.x + box.w, box.y + box.h);
    const inset = Math.ceil(insetU * scale);
    let inkL = Infinity, inkT = Infinity, inkR = -Infinity, inkB = -Infinity;
    for (let y = Math.max(0, tl.y + inset); y < Math.min(img.height, br.y - inset); y += 1) {
      for (let x = Math.max(0, tl.x + inset); x < Math.min(img.width, br.x - inset); x += 1) {
        if (INK(img.at(x, y))) {
          inkL = Math.min(inkL, x); inkT = Math.min(inkT, y);
          inkR = Math.max(inkR, x); inkB = Math.max(inkB, y);
        }
      }
    }
    if (!Number.isFinite(inkL)) return null;
    return {
      w: u(inkR - inkL + 1), h: u(inkB - inkT + 1),
      pxL: inkL, pxT: inkT, pxR: inkR, pxB: inkB,
      padL: u(inkL - tl.x), padT: u(inkT - tl.y), padR: u(br.x - 1 - inkR), padB: u(br.y - 1 - inkB),
    };
  };
  // Returns the report line for a box plus the ink it found, so a caller that
  // sizes the box from that ink measures the pixels once.
  const boxLine = (prefix, box, insetU) => {
    const ink = inkIn(box, insetU);
    if (!ink) {
      return {
        ink,
        text: `${prefix}: box ${box.w}x${box.h}u at (${box.x},${box.y}), no ink found inside (past the ${insetU}u border inset)`,
      };
    }
    return {
      ink,
      text: `${prefix}: box ${box.w}x${box.h}u at (${box.x},${box.y}), ink ${ink.w}x${ink.h}u, ` +
        `padding L=${ink.padL} T=${ink.padT} R=${ink.padR} B=${ink.padB}u ` +
        `(ink beyond the ${insetU}u border inset)`,
    };
  };
  const round1 = (n) => Math.round(n * 10) / 10;
  const signed = (n) => (n > 0 ? `+${round1(n)}` : `${round1(n)}`);
  // The box the uniform padding rule implies for the ink just measured, and how
  // far the declared box is from it: the answer a resize is looking for, without
  // a second render to check it. A stroked shape's border counts as ink at the
  // plain inset, so the fit peels the inset until the ink pulls clear of the
  // scan window on every side, leaving the text alone.
  const fitLine = (id, c, box) => {
    let inset = 2, ink = null;
    for (; inset <= 12; inset += 1) {
      ink = inkIn(box, inset);
      if (!ink) break;
      const clear = Math.min(ink.padL, ink.padT, ink.padR, ink.padB);
      if (clear > 0.4) break; // ink no longer touches the window: the border is peeled off
    }
    if (!ink) return `  fit ${id}: no text ink found inside the border, nothing to size the box to`;
    const impliedW = round1(ink.w + 2 * FIT_PAD_X);
    const impliedH = round1(ink.h + 2 * FIT_PAD_Y);
    if (collect !== null) collect.fits.push({ id, impliedW, impliedH });
    const peeled = inset > 2 ? ` (border peeled at a ${inset}u inset)` : "";
    const sp = c.style;
    const spacing = ["spacing", "spacingLeft", "spacingRight", "spacingTop", "spacingBottom"]
      .filter((k) => Number(sp[k] ?? 0) !== 0).map((k) => `${k}=${sp[k]}`).join(" ");
    const spacingNote = spacing ? ` [declared ${spacing} already insets the ink: the delta partly restates it]` : "";
    return `  fit ${id}: ink ${ink.w}x${ink.h}u + padding ${FIT_PAD_X}u L/R ${FIT_PAD_Y}u T/B ` +
      `-> implied box ${impliedW}x${impliedH}u, declared ${box.w}x${box.h}u, ` +
      `delta ${signed(impliedW - box.w)}x${signed(impliedH - box.h)}u${peeled}${spacingNote}`;
  };
  // Walks an axis-aligned run in pixels and reports how much of it stays
  // visible on each side of the label's knockout. The stroke is matched by
  // colour with a tight tolerance: antialiased glyph edges match anything
  // looser and fabricate phantom breaks.
  const TOL = 40;
  const visibleRun = (run, labelBox, rgb) => {
    const strokePx = Math.max(2, Math.ceil(2 * scale));
    const matches = (x, y) => {
      for (let d = -strokePx; d <= strokePx; d += 1) {
        const [r, g, bl, a] = run.vertical
          ? (x + d >= 0 && x + d < img.width ? img.at(x + d, y) : [255, 255, 255, 0])
          : (y + d >= 0 && y + d < img.height ? img.at(x, y + d) : [255, 255, 255, 0]);
        if (a > 16 && Math.abs(r - rgb[0]) <= TOL && Math.abs(g - rgb[1]) <= TOL && Math.abs(bl - rgb[2]) <= TOL) return true;
      }
      return false;
    };
    const a = toPx(run.vertical ? run.coord : run.lo, run.vertical ? run.lo : run.coord);
    const bpx = toPx(run.vertical ? run.coord : run.hi, run.vertical ? run.hi : run.coord);
    const lo = run.vertical ? a.y : a.x, hi = run.vertical ? bpx.y : bpx.x;
    const fixed = run.vertical ? a.x : a.y;
    const labelLo = toPx(labelBox.x, labelBox.y);
    const labelHi = toPx(labelBox.x + labelBox.w, labelBox.y + labelBox.h);
    const gapLo = run.vertical ? labelLo.y : labelLo.x;
    const gapHi = run.vertical ? labelHi.y : labelHi.x;
    let beforeVisible = 0, afterVisible = 0;
    for (let p = Math.max(0, lo); p <= hi; p += 1) {
      const visible = run.vertical ? matches(fixed, p) : matches(p, fixed);
      if (!visible) continue;
      if (p < gapLo) beforeVisible += 1;
      else if (p > gapHi) afterVisible += 1;
    }
    return { before: u(beforeVisible), after: u(afterVisible) };
  };
  const fits = new Set(fitIds);
  for (const id of cellIds) {
    const c = cells.get(id);
    if (!c || c.attrs.vertex !== "1" || !c.geo) {
      lines.push(`cell ${id}: not a vertex with geometry`);
      continue;
    }
    const parentEdge = cells.get(c.attrs.parent);
    if (parentEdge?.attrs.edge === "1") {
      // An edge label's geometry is relative: resolve its anchor from the
      // parent edge's pinned polyline, then measure ink in its estimated box,
      // the TEXT box tight around the estimate and a padded halo separately,
      // so the edge's own stroke reads as foreign ink rather than as zero
      // padding on the text.
      const entry = labels.find((l) => l.cell.id === id);
      if (!entry) {
        lines.push(`cell ${id}: label of edge ${parentEdge.id}, which has no pinned polyline to anchor on`);
        continue;
      }
      const text = boxLine(`label ${id} on edge ${parentEdge.id} (text box)`, entry.box, 0);
      const halo = { x: entry.box.x - 4, y: entry.box.y - 4, w: entry.box.w + 8, h: entry.box.h + 8 };
      const haloInk = inkIn(halo, 0);
      let foreign = "no foreign ink in the 4u halo";
      if (haloInk && text.ink) {
        const grew = Math.max(
          text.ink.pxL - haloInk.pxL, haloInk.pxR - text.ink.pxR,
          text.ink.pxT - haloInk.pxT, haloInk.pxB - text.ink.pxB,
        );
        if (grew > scale) foreign = `foreign ink inside the 4u halo (${u(grew)}u beyond the text ink: the edge's own stroke or a neighbour)`;
      } else if (haloInk && !text.ink) {
        foreign = "only foreign ink: nothing inside the text box itself";
      }
      const off = c.offset ? ` offset (${c.offset.x},${c.offset.y})` : " no offset";
      lines.push(
        text.text +
          ` [anchor (${Math.round(entry.anchor.x)},${Math.round(entry.anchor.y)}) pos=${c.geo.x ?? 0}${off}; ` +
          `${foreign}; box is the char-count estimate, align-aware]`,
      );
      // The knockout must leave visible run on both sides of the text: an
      // arrowhead-only stub is the orphaned-run defect the guide names.
      if (!isSpecimenEdge(cells, parentEdge)) {
        const res = pinnedPolyline(cells, parentEdge);
        if (res.pts) {
          const runs = [];
          for (let i = 0; i + 1 < res.pts.length; i += 1) {
            const p = res.pts[i], q = res.pts[i + 1];
            if (Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) > 0.01) {
              runs.push({ vertical: true, coord: p.x, lo: Math.min(p.y, q.y), hi: Math.max(p.y, q.y) });
            } else if (Math.abs(p.y - q.y) < 0.01 && Math.abs(p.x - q.x) > 0.01) {
              runs.push({ vertical: false, coord: p.y, lo: Math.min(p.x, q.x), hi: Math.max(p.x, q.x) });
            }
          }
          const centre = { x: entry.box.x + entry.box.w / 2, y: entry.box.y + entry.box.h / 2 };
          const dist = (r) => Math.abs((r.vertical ? centre.x : centre.y) - r.coord);
          const near = runs.filter((r) => {
            const along = r.vertical ? centre.y : centre.x;
            return along >= r.lo - 8 && along <= r.hi + 8;
          }).sort((p, q) => dist(p) - dist(q))[0];
          const rgb = strokeRgb(parentEdge.style);
          if (near && rgb) {
            const vis = visibleRun(near, entry.box, rgb);
            const short = Math.min(vis.before, vis.after) < 20 ? " (a side under 20u reads as an orphaned stub)" : "";
            lines.push(`  visible run ${id}: ${vis.before}u before the knockout, ${vis.after}u after${short}`);
          }
        }
      }
      if (fits.has(id)) {
        lines.push(
          `  fit ${id}: an edge label declares no box (it rides its edge and sizes itself), ` +
            `so there is nothing to fit`,
        );
      }
      continue;
    }
    const box = bbox(cells, c);
    const measured = boxLine(`cell ${id}`, box, 2);
    lines.push(measured.text);
    if (fits.has(id)) lines.push(fitLine(id, c, box));
    // A container or group: measure each vertex child too, so box-hug
    // questions (is the text padded inside its box) are answerable directly.
    const children = [...cells.values()].filter(
      (k) => k.attrs.parent === id && k.attrs.vertex === "1" && k.geo,
    );
    for (const child of children) {
      // A fit on a child needs no handling here: every --fit id is measured in
      // its own right by the loop above, where the fit line follows it.
      lines.push("  " + boxLine(`child ${child.id}`, bbox(cells, child), 2).text);
    }
  }
  // Dead-space questions: each child's clearance to the container's sides, and
  // the largest empty rectangle inside the container. Candidate rectangle
  // edges come from the child boxes themselves, which is where an axis-aligned
  // maximal rectangle must end.
  for (const id of gapIds) {
    const c = cells.get(id);
    if (!c || c.attrs.vertex !== "1" || !c.geo) {
      lines.push(`gaps ${id}: not a vertex with geometry`);
      continue;
    }
    const outer = bbox(cells, c);
    const kids = [...cells.values()]
      .filter((k) => k.attrs.parent === id && k.attrs.vertex === "1" && k.geo)
      .map((k) => ({ id: k.id, b: bbox(cells, k) }));
    lines.push(`gaps ${id}: box ${outer.w}x${outer.h}u at (${outer.x},${outer.y}), ${kids.length} child(ren)`);
    for (const k of kids) {
      lines.push(
        `  child ${k.id}: clearance L=${round1(k.b.x - outer.x)} T=${round1(k.b.y - outer.y)} ` +
          `R=${round1(outer.x + outer.w - (k.b.x + k.b.w))} B=${round1(outer.y + outer.h - (k.b.y + k.b.h))}u`,
      );
    }
    const xs = [...new Set([outer.x, outer.x + outer.w, ...kids.flatMap((k) => [k.b.x, k.b.x + k.b.w])])].sort((p, q) => p - q);
    const ys = [...new Set([outer.y, outer.y + outer.h, ...kids.flatMap((k) => [k.b.y, k.b.y + k.b.h])])].sort((p, q) => p - q);
    let best = null;
    for (let i = 0; i < xs.length; i += 1) for (let j = i + 1; j < xs.length; j += 1) {
      for (let k = 0; k < ys.length; k += 1) for (let l = k + 1; l < ys.length; l += 1) {
        const r = { x: xs[i], y: ys[k], w: xs[j] - xs[i], h: ys[l] - ys[k] };
        if (r.x < outer.x || r.y < outer.y || r.x + r.w > outer.x + outer.w || r.y + r.h > outer.y + outer.h) continue;
        const blocked = kids.some(
          (kid) => kid.b.x < r.x + r.w && r.x < kid.b.x + kid.b.w && kid.b.y < r.y + r.h && r.y < kid.b.y + kid.b.h,
        );
        if (!blocked && (best === null || r.w * r.h > best.w * best.h)) best = r;
      }
    }
    if (best) {
      lines.push(
        `  largest empty rectangle: ${round1(best.w)}x${round1(best.h)}u at (${round1(best.x)},${round1(best.y)})`,
      );
    }
  }
  // The icon-gap sweep: the style guide's minimum clear space between an
  // icon's rendered ink and its box's first glyph is judged on the render,
  // never on cell geometry (cell constants can be uniform while one icon's
  // ink fills its cell and touches the text). Pairing is geometric, since an
  // icon may be the box's child or a sibling positioned inside its bounds.
  if (iconGaps) {
    const isImage = (k) => k.attrs.vertex === "1" && k.geo &&
      (k.style.shape === "image" || k.style.image !== undefined);
    const contains = (outer, inner) =>
      inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
      inner.x + inner.w <= outer.x + outer.w + 0.5 &&
      inner.y + inner.h <= outer.y + outer.h + 0.5;
    const images = [...cells.values()].filter(isImage).map((k) => ({ cell: k, b: bbox(cells, k) }));
    let pairs = 0, under = 0;
    for (const c of cells.values()) {
      if (c.attrs.vertex !== "1" || !c.geo || isImage(c)) continue;
      if ((c.attrs.value ?? "").trim() === "") continue;
      if (cells.get(c.attrs.parent)?.attrs.edge === "1") continue;
      const box = bbox(cells, c);
      const inside = images.filter((i) => i.cell.id !== c.id && contains(box, i.b));
      if (inside.length === 0) continue;
      pairs += 1;
      // The rightmost icon is the one the text sits beside; the gap scans
      // rightward from its cell so an overlap reads as a small gap, not a miss.
      const icon = inside.reduce((a, i) => (i.b.x + i.b.w > a.b.x + a.b.w ? i : a));
      // The icon window extends 6u past the cell: the calibration's affine
      // carries a few units of systematic offset (its residual is split
      // evenly, so an asymmetric label estimate leaves a shift), and icon ink
      // displaced past the mapped cell edge must count as icon, never as
      // text. The guard band sits under the default minimum on purpose: a
      // true gap smaller than the band is absorbed into the icon ink and
      // reads as ~0, which is the flagged answer such a gap deserves.
      const ICON_GUARD = 6;
      const iconInk = inkIn({ x: icon.b.x, y: icon.b.y, w: icon.b.w + ICON_GUARD, h: icon.b.h }, 0);
      if (!iconInk) {
        lines.push(`icon gap ${c.id}: icon ${icon.cell.id} has no rendered ink (a broken payload renders blank)`);
        continue;
      }
      if (iconInk.padR < 0.4) {
        // Ink to the window's edge is either a true gap under the guard band
        // or a calibration shift past it: both demand eyes, neither may pass.
        lines.push(
          `icon gap ${c.id}: ink saturates icon ${icon.cell.id}'s ${ICON_GUARD}u guard window ` +
            `(a true gap under the band, or a calibration shift past it): judge this pair by crop ${ICON_GAP_FLAG}`,
        );
        under += 1;
        continue;
      }
      // The box's own border stroke must never read as the first glyph, so
      // the text window peels its inset the way fitLine does: grow it until
      // the ink pulls clear of the top, bottom and right window edges. The
      // left edge is exempt, since a tight gap legitimately puts glyph ink
      // there.
      const left = icon.b.x + icon.b.w + ICON_GUARD;
      let textInk = null;
      for (let inset = 2; inset <= 8; inset += 1) {
        const region = { x: left, y: box.y + inset, w: box.x + box.w - left - inset, h: box.h - 2 * inset };
        textInk = region.w > 0 && region.h > 0 ? inkIn(region, 0) : null;
        if (!textInk) break;
        if (textInk.padT > 0.4 && textInk.padB > 0.4 && textInk.padR > 0.4) break;
      }
      if (!textInk) {
        lines.push(`icon gap ${c.id}: no text ink found right of icon ${icon.cell.id} (past the border inset)`);
        continue;
      }
      const gap = u(textInk.pxL - iconInk.pxR - 1);
      const flag = gap < minIconGap ? ` ${ICON_GAP_FLAG}` : "";
      lines.push(
        `icon gap ${c.id}: ${gap}u between icon ${icon.cell.id} ink and the first glyph, minimum ${minIconGap}u${flag}`,
      );
      if (flag) under += 1;
    }
    lines.push(
      pairs === 0
        ? "icon gaps: no labelled box contains an image cell, so the sweep inspected nothing (vacuous, not green)"
        : `icon gaps: ${pairs} pair(s) inspected, ${under} under the ${minIconGap}u minimum`,
    );
  }
  return lines.join("\n");
}
