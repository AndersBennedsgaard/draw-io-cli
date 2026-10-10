import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticRender } from "./png-fixture.mjs";

// The icon-gap sweep, case by case: a touching icon+text pair is flagged and
// fails the exit code, a generous pair passes, a model without icon boxes
// reports the sweep as vacuous, and the flag plumbing refuses a tuner without
// its sweep. Fixtures are the synthetic rendered pairs of test/png-fixture.mjs.

const testDir = dirname(fileURLToPath(import.meta.url));
const cli = join(dirname(testDir), "src", "cli.js");

const box = (id, value, y) =>
  `<mxCell id="${id}" value="${value}" style="rounded=0;html=1;spacingLeft=34;align=center;" vertex="1" parent="1">` +
  `<mxGeometry x="0" y="${y}" width="200" height="40" as="geometry"/></mxCell>`;
const icon = (id, y) =>
  `<mxCell id="${id}" value="" style="shape=image;aspect=fixed;image=data:image/png,AAAA;" vertex="1" parent="1">` +
  `<mxGeometry x="12" y="${y}" width="26" height="26" as="geometry"/></mxCell>`;
const model = (cells) =>
  `<mxfile><diagram id="d1" name="fixture"><mxGraphModel><root>` +
  `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;

const dir = mkdtempSync(join(tmpdir(), "icon-gaps-"));
try {
  // Two pairs on one 200x100 canvas at scale 1, border 0, each box drawn WITH
  // its border stroke: the border must never read as the first glyph. Icons
  // fill their cells (ink right edge x=37). The good text starts at x=58
  // (gap 20u), the tight text at x=42: a gap inside the guard band, the
  // planted violation, reported as window saturation and flagged.
  const outline = (x, y, w, h) => [
    { x, y, w, h: 1 }, { x, y: y + h - 1, w, h: 1 },
    { x, y, w: 1, h }, { x: x + w - 1, y, w: 1, h },
  ];
  const both = syntheticRender(200, 100, [
    ...outline(0, 0, 200, 40), ...outline(0, 60, 200, 40),
    { x: 12, y: 7, w: 26, h: 26 }, { x: 58, y: 15, w: 60, h: 10 },
    { x: 12, y: 67, w: 26, h: 26 }, { x: 42, y: 75, w: 60, h: 10 },
  ], model(box("good-box", "Good", 0) + icon("good-icon", 7) + box("tight-box", "Tight", 60) + icon("tight-icon", 67)));
  const bothPath = join(dir, "both.drawio.png");
  writeFileSync(bothPath, both);
  const flagged = spawnSync("node", [cli, "measure", bothPath, "--icon-gaps", "--scale", "1", "--border", "0"], { encoding: "utf8" });
  assert.equal(flagged.status, 1, `planted violation must fail the exit code, got ${flagged.status}: ${flagged.stderr}`);
  assert.match(flagged.stdout, /icon gap good-box: 20u between icon good-icon ink and the first glyph, minimum 8u\n/);
  assert.match(flagged.stdout, /icon gap tight-box: ink saturates icon tight-icon's 6u guard window .*judge this pair by crop UNDER MINIMUM/);
  assert.match(flagged.stdout, /icon gaps: 2 pair\(s\) inspected, 1 under the 8u minimum/);
  assert.ok(!/good-box.*UNDER MINIMUM/.test(flagged.stdout), "the generous pair must not be flagged");

  // The tuner moves the bar: at 25u the generous pair is under it too.
  const tuned = spawnSync("node", [cli, "measure", bothPath, "--icon-gaps", "--min-icon-gap", "25", "--scale", "1", "--border", "0"], { encoding: "utf8" });
  assert.equal(tuned.status, 1, `a 25u minimum flags the 20u pair as well, got ${tuned.status}`);
  assert.match(tuned.stdout, /icon gap good-box: 20u between icon good-icon ink and the first glyph, minimum 25u UNDER MINIMUM/);
  assert.match(tuned.stdout, /icon gaps: 2 pair\(s\) inspected, 2 under the 25u minimum/);

  // A model with a labelled box and no image cell reports vacuity, not green.
  const vacuousPng = syntheticRender(200, 40, [], model(box("plain-box", "Plain", 0)));
  const vacuousPath = join(dir, "vacuous.drawio.png");
  writeFileSync(vacuousPath, vacuousPng);
  const vacuous = spawnSync("node", [cli, "measure", vacuousPath, "--icon-gaps", "--scale", "1", "--border", "0"], { encoding: "utf8" });
  assert.equal(vacuous.status, 0, `a vacuous sweep is not a failure, got ${vacuous.status}: ${vacuous.stderr}`);
  assert.match(vacuous.stdout, /icon gaps: no labelled box contains an image cell, so the sweep inspected nothing \(vacuous, not green\)/);

  // The tuner without its sweep is refused before any file is read.
  const orphanTuner = spawnSync("node", [cli, "measure", join(dir, "absent.drawio.png"), "--min-icon-gap", "8"], { encoding: "utf8" });
  assert.notEqual(orphanTuner.status, 0, "--min-icon-gap without --icon-gaps must be refused");
  assert.match(orphanTuner.stderr, /--min-icon-gap only tunes --icon-gaps/);

  console.log("icon-gap sweep tests passed (4 invocations)");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
