import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { syntheticRender } from "./png-fixture.mjs";
import { predictedExportSize } from "../src/measure.js";
import { pngSize } from "../src/png.js";

// Calibration, the affine mapping, crop and fit-box, case by case, on
// synthetic rendered pairs sized exactly as the model predicts (residual
// zero) or deliberately off it: a residual on an axis bounded by an icon
// caption is attributed and never warns, the same residual on an axis bounded
// by a plain shape warns, --affine prints under a warning with the error bar
// named, crop maps a model region to the predicted pixels, and fit-box writes
// the box the ink implies.

const testDir = dirname(fileURLToPath(import.meta.url));
const cli = join(dirname(testDir), "src", "cli.js");

const model = (cells) =>
  `<mxfile><diagram id="d1" name="fixture"><mxGraphModel><root>` +
  `<mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root></mxGraphModel></diagram></mxfile>`;
const box = (id, x, y, w, h, value = "", style = "rounded=0;whiteSpace=wrap;html=1;") =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1">` +
  `<mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
const CAPTIONED = "shape=image;verticalLabelPosition=top;verticalAlign=bottom;image=data:image/png,AAAA;";

const SCALE = 2, BORDER = 10;
const settings = { scale: SCALE, border: BORDER };

function run(args, expectStatus = 0) {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  assert.equal(result.status, expectStatus, `drawio-cli ${args.join(" ")} exited ${result.status}, want ${expectStatus}\n${result.stderr}\n${result.stdout}`);
  return result;
}

let passed = 0;
const ok = (name) => { passed += 1; console.log(`ok  ${name}`); };

const dir = mkdtempSync(join(tmpdir(), "drawio-cli-measure-"));
try {
  // A plain box: the PNG matches the prediction, so no warning and the affine prints.
  const plain = model(box("a", 0, 0, 120, 40, "A"));
  const plainSize = predictedExportSize(plain, settings);
  const plainPng = join(dir, "plain.drawio.png");
  writeFileSync(plainPng, syntheticRender(plainSize.width, plainSize.height, [], plain));
  const exact = run(["measure", plainPng, "--affine", "--scale", String(SCALE), "--border", String(BORDER)]).stdout;
  assert.ok(!exact.includes("WARNING"), `an exact render must not warn:\n${exact}`);
  assert.match(exact, /affine x: px = \(mx - 0\) \* 2 \+ 20/, "the affine prints the mapping");
  ok("measure: an exact render calibrates with no warning and prints the affine");

  // The same box with a PNG 12px wider than predicted: an unexplained residual warns,
  // and the affine still prints, naming the error bar.
  writeFileSync(plainPng, syntheticRender(plainSize.width + 12, plainSize.height, [], plain));
  const off = run(["measure", plainPng, "--affine", "--scale", String(SCALE), "--border", String(BORDER)]).stdout;
  assert.match(off, /calibration: WARNING/, "an unexplained residual warns");
  assert.match(off, /affine: error bar 12,0px/, "the affine names the residual as its error bar");
  assert.match(off, /affine x: px =/, "the affine still prints under a warning");
  ok("measure: an unexplained residual warns and the affine prints with its error bar");

  // A captioned icon sets the top bound with an estimated box: the same 12px
  // residual on that axis is attributed, so it is a note rather than a warning.
  const captioned = model(box("i", 100, 60, 26, 26, "Browser", CAPTIONED) + box("b", 0, 100, 300, 40, "B"));
  const capSize = predictedExportSize(captioned, settings);
  const capPng = join(dir, "captioned.drawio.png");
  writeFileSync(capPng, syntheticRender(capSize.width, capSize.height + 12, [], captioned));
  const attributed = run(["measure", capPng, "--cell", "b", "--scale", String(SCALE), "--border", String(BORDER)]).stdout;
  assert.ok(!attributed.includes("WARNING"), `a caption-bounded residual must not warn:\n${attributed}`);
  assert.match(attributed, /calibration: note residual 0,12px .* attributed to bound-setting edges or estimated boxes \(i\)/, "the caption is named as the estimate");
  ok("measure: a residual on a caption-bounded axis is attributed, not a warning");

  // crop: a model region maps to exactly the predicted pixels.
  writeFileSync(plainPng, syntheticRender(plainSize.width, plainSize.height, [], plain));
  const cropOut = join(dir, "crop.png");
  run(["crop", plainPng, "--region", "10,5,50,20", "-o", cropOut, "--scale", String(SCALE), "--border", String(BORDER)]);
  assert.deepEqual(pngSize(readFileSync(cropOut)), { width: 100, height: 40 }, "the crop is the region at scale");
  run(["crop", plainPng, "--region", "nope"], 1);
  ok("crop: a model region crops to its predicted pixel size and a bad region is refused");

  // fit-box: ink painted inside an oversized box implies a hugging box, which
  // fit-box writes; a stale sibling is refused.
  const big = model(box("t", 0, 0, 200, 100, "T"));
  const bigSize = predictedExportSize(big, settings);
  const bigSource = join(dir, "big.drawio");
  writeFileSync(bigSource, big);
  // Ink 40x16 model units at (30,30): pixels (border + 30) * scale onward.
  const ink = { x: (BORDER + 30) * SCALE, y: (BORDER + 30) * SCALE, w: 40 * SCALE, h: 16 * SCALE };
  writeFileSync(`${bigSource}.png`, syntheticRender(bigSize.width, bigSize.height, [ink], big));
  run(["fit-box", bigSource, "t", "--scale", String(SCALE), "--border", String(BORDER)]);
  const fitted = readFileSync(bigSource, "utf8");
  assert.match(fitted, /id="t"[^>]*>\s*<mxGeometry x="0" y="0" width="56" height="28"/, `fit-box must write ink plus padding (40+16 by 16+12), got:\n${fitted}`);
  const stale = run(["fit-box", bigSource, "t", "--scale", String(SCALE), "--border", String(BORDER)], 1);
  assert.match(stale.stderr, /refuses a stale sibling/, "the sibling no longer matches the edited source");
  ok("fit-box: writes the implied box and refuses a stale sibling");

  console.log(`measure: ${passed} cases passed`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
