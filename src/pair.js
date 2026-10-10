import { parseCells, decodeEntities } from "./lint.js";
import { geoKey, pointsKey, offsetKey } from "./curate.js";

/**
 * Whether a rendered sibling still carries its source's model: every cell's
 * value, style, parent, geometry, waypoints and label offset match, and no
 * cell exists on one side only. Values are compared decoded to a fixpoint,
 * since the webapp re-spells entities (an apostrophe comes back as `&#39;`)
 * without changing what renders. Geometry is rounded to a thousandth and a
 * missing coordinate reads as zero, which is how the webapp omits them.
 *
 * @param sourceXml - The .drawio source's model.
 * @param renderedXml - The model extracted from the rendered sibling.
 * @returns lines - One line per differing cell, empty when the pair is fresh.
 */
export function comparePair(sourceXml, renderedXml) {
  const a = parseCells(sourceXml);
  const b = parseCells(renderedXml);
  const lines = [];
  for (const id of new Set([...a.keys(), ...b.keys()])) {
    const ca = a.get(id);
    const cb = b.get(id);
    if (!ca) { lines.push(`cell ${id}: only in the rendered sibling`); continue; }
    if (!cb) { lines.push(`cell ${id}: only in the source`); continue; }
    const deltas = [];
    if (decodeEntities(ca.attrs.value ?? "") !== decodeEntities(cb.attrs.value ?? "")) deltas.push("value");
    if ((ca.attrs.style ?? "") !== (cb.attrs.style ?? "")) deltas.push("style");
    if ((ca.attrs.parent ?? "") !== (cb.attrs.parent ?? "")) deltas.push("parent");
    if (geoKey(ca) !== geoKey(cb)) deltas.push(`geometry ${geoKey(ca)} -> ${geoKey(cb)}`);
    if (pointsKey(ca) !== pointsKey(cb)) deltas.push("waypoints");
    if (offsetKey(ca) !== offsetKey(cb)) deltas.push("label offset");
    if (deltas.length > 0) lines.push(`cell ${id}: ${deltas.join(", ")}`);
  }
  return lines;
}
