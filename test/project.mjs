import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticRender } from "./png-fixture.mjs";

// check-pair and check-project, case by case: a fresh pair passes, a pair
// whose source moved on without a re-render is named stale with the cell
// that changed, a missing sibling fails, an entity re-spelling in the render
// is not a difference, and check-project reports one line per layout
// assertion with every assertion seen failing on its own fixture variant.
// Renders are the synthetic pairs of test/png-fixture.mjs, so no browser runs.

const testDir = dirname(fileURLToPath(import.meta.url));
const cli = join(dirname(testDir), "src", "cli.js");

const model = (cells) =>
  `<mxfile><diagram id="d1" name="fixture"><mxGraphModel><root>` +
  `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const box = (id, value, x, style = "rounded=0;whiteSpace=wrap;html=1;") =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1">` +
  `<mxGeometry x="${x}" y="40" width="120" height="40" as="geometry"/></mxCell>`;

const SOURCE = model(box("a", "Alpha", 0) + box("b", "Bob&#39;s", 200));
// The webapp re-spells the apostrophe and omits a zero coordinate.
const RENDERED_SAME = model(box("a", "Alpha", 0) + box("b", "Bob's", 200)).replace('x="0" ', "");
const RENDERED_OLD = model(box("a", "Alpha", 0) + box("b", "Bob&#39;s", 260));

const PALETTE = model(box("swatch", "Plain box", 0));

function invoke(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
}

let passed = 0;
function expect(name, args, status, needle) {
  const result = invoke(args);
  assert.equal(result.status, status, `${name}: "${args.join(" ")}" exited ${result.status}, want ${status}\n${result.stdout}\n${result.stderr}`);
  const text = result.stdout + result.stderr;
  assert.ok(text.includes(needle), `${name}: output should mention "${needle}", got:\n${text}`);
  passed += 1;
  console.log(`ok  ${name}`);
  return result;
}

const dir = mkdtempSync(join(tmpdir(), "drawio-cli-project-"));
try {
  // check-pair over three sources: fresh, stale and unrendered.
  const fresh = join(dir, "fresh.drawio");
  writeFileSync(fresh, SOURCE);
  writeFileSync(`${fresh}.png`, syntheticRender(8, 8, [], RENDERED_SAME));
  const stale = join(dir, "stale.drawio");
  writeFileSync(stale, SOURCE);
  writeFileSync(`${stale}.png`, syntheticRender(8, 8, [], RENDERED_OLD));
  const bare = join(dir, "bare.drawio");
  writeFileSync(bare, SOURCE);

  expect("check-pair: fresh pair passes despite entity re-spelling", ["check-pair", fresh], 0, "rendered sibling is fresh");
  const staleRun = expect("check-pair: stale pair fails naming the cell", ["check-pair", stale], 1, "rendered sibling is STALE");
  assert.match(staleRun.stdout, /cell b: geometry/, "the moved cell must be named");
  expect("check-pair: missing sibling fails", ["check-pair", bare], 1, "rendered sibling");
  expect("check-pair: several inputs aggregate", ["check-pair", fresh, stale], 1, "fresh.drawio: rendered sibling is fresh");
  expect("check-pair: refuses a render as input", ["check-pair", `${fresh}.png`], 1, "takes the .drawio source");

  // check-project: a conforming tree passes every assertion.
  const project = join(dir, "project");
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(join(project, "drawio.config.json"), JSON.stringify({ render: { scale: 2, border: 5 }, lint: { palette: "docs/diagram-palette.drawio" } }));
  writeFileSync(join(project, "docs", "diagramming.md"), "# Diagrams\n");
  writeFileSync(join(project, "docs", "diagram-palette.drawio"), PALETTE);
  writeFileSync(join(project, "docs", "diagram-palette.drawio.png"), syntheticRender(8, 8, [], PALETTE));
  writeFileSync(join(project, "docs", "flow.drawio"), SOURCE);
  writeFileSync(join(project, "docs", "flow.drawio.png"), syntheticRender(8, 8, [], RENDERED_SAME));
  const good = expect("check-project: conforming tree passes", ["check-project", join(project, "docs")], 0, "check-project: 0 failure(s)");
  assert.match(good.stdout, /ok {3}config parses \(render scale 2, border 5\)/);
  assert.match(good.stdout, /ok {3}flow\.drawio: lints with 0 error\(s\), 0 warning\(s\)/, "every source gets a lint line");
  assert.match(good.stdout, /ok {3}palette .* lints with 0 error\(s\)/);
  assert.match(good.stdout, /ok {3}2 diagram source\(s\)/);

  // One assertion failing per variant, each seen failing on its own.
  const variant = (name, mutate) => {
    const root = join(dir, name);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "drawio.config.json"), JSON.stringify({ lint: { palette: "docs/diagram-palette.drawio" } }));
    writeFileSync(join(root, "docs", "diagramming.md"), "# Diagrams\n");
    writeFileSync(join(root, "docs", "diagram-palette.drawio"), PALETTE);
    writeFileSync(join(root, "docs", "diagram-palette.drawio.png"), syntheticRender(8, 8, [], PALETTE));
    mutate(root);
    return join(root, "docs");
  };
  expect("check-project: no config at or above the tree fails", ["check-project", variant("noconfig", (r) => rmSync(join(r, "drawio.config.json")))], 1, "no drawio.config.json at or above");
  expect("check-project: unparseable config fails", ["check-project", variant("badconfig", (r) => writeFileSync(join(r, "drawio.config.json"), "{ nope"))], 1, "config does not parse");
  expect("check-project: missing style guide fails", ["check-project", variant("noguide", (r) => rmSync(join(r, "docs", "diagramming.md")))], 1, "diagramming.md is missing");
  expect("check-project: config without a palette fails", ["check-project", variant("nopalette", (r) => writeFileSync(join(r, "drawio.config.json"), "{}"))], 1, "config sets no lint.palette");
  expect("check-project: missing palette file fails", ["check-project", variant("gonepalette", (r) => rmSync(join(r, "docs", "diagram-palette.drawio")))], 1, "is missing");
  expect("check-project: palette with a lint error fails", ["check-project", variant("badpalette", (r) => {
    writeFileSync(join(r, "docs", "diagram-palette.drawio"), model(box("map", "Poison", 0)));
  })], 1, "lints with 1 error(s)");
  expect("check-project: stale pair fails", ["check-project", variant("stalepair", (r) => {
    writeFileSync(join(r, "docs", "flow.drawio"), SOURCE);
    writeFileSync(join(r, "docs", "flow.drawio.png"), syntheticRender(8, 8, [], RENDERED_OLD));
  })], 1, "rendered sibling is stale");
  expect("check-project: unrendered source fails", ["check-project", variant("unrendered", (r) => writeFileSync(join(r, "docs", "flow.drawio"), SOURCE))], 1, "rendered sibling flow.drawio.png is missing");
  expect("check-project: a tree with no diagrams fails loudly", ["check-project", variant("empty", (r) => {
    rmSync(join(r, "docs", "diagram-palette.drawio"));
    rmSync(join(r, "docs", "diagram-palette.drawio.png"));
    writeFileSync(join(r, "docs", "diagram-palette.drawio"), PALETTE);
    rmSync(join(r, "docs", "diagram-palette.drawio"));
  })], 1, "nothing to check");
  expect("check-project: a file path is refused", ["check-project", fresh], 1, "is not a directory");
  const poisoned = expect("check-project: a source with a lint error fails on its lint line", ["check-project", variant("linterror", (r) => {
    writeFileSync(join(r, "docs", "flow.drawio"), model(box("map", "Poison", 0)));
    writeFileSync(join(r, "docs", "flow.drawio.png"), syntheticRender(8, 8, [], model(box("map", "Poison", 0))));
  })], 1, "flow.drawio: lints with 1 error(s)");
  assert.match(poisoned.stdout, /FAIL flow\.drawio: lints with 1 error/);

  // A clamped sibling: the PNG sits on the exporter's canvas limit on one axis.
  const clampedDir = variant("clamped", (r) => {
    writeFileSync(join(r, "docs", "flow.drawio"), SOURCE);
    writeFileSync(join(r, "docs", "flow.drawio.png"), syntheticRender(8, 16384, [], RENDERED_SAME));
  });
  expect("check-project: a clamped sibling is stale", ["check-project", clampedDir], 1, "rendered sibling is clamped");
  expect("check-pair: a clamped sibling fails naming the limit", ["check-pair", join(clampedDir, "flow.drawio")], 1, "over the exporter's 16384px canvas limit");

  console.log(`project: ${passed} cases passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
