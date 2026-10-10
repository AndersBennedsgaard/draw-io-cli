import assert from "node:assert/strict";
import { lint } from "../src/lint.js";

// Every check is proven by a planted violation seen firing, with a clean
// control beside it where absence is the assertion. Pure lint, no rendering.

function wrap(cells) {
  return `<mxfile><diagram name="t" id="t1"><mxGraphModel><root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    ${cells}
  </root></mxGraphModel></diagram></mxfile>`;
}

const box = (id, x, y, w = 120, h = 40, value = "", style = "rounded=0;whiteSpace=wrap;html=1;") =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry" /></mxCell>`;

const edge = (id, source, target, style, waypoints = "", label = "") =>
  `<mxCell id="${id}" style="${style}" edge="1" parent="1" source="${source}" target="${target}"><mxGeometry relative="1" as="geometry">${waypoints}</mxGeometry></mxCell>${label}`;

const PIN_LR = "html=1;strokeWidth=2;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;";

const ridingLabel = (id, on, value, style = "edgeLabel;html=1;align=left;verticalAlign=middle;", pos = 0, offset = "") =>
  `<mxCell id="${id}" value="${value}" style="${style}" vertex="1" connectable="0" parent="${on}"><mxGeometry x="${pos}" relative="1" as="geometry">${offset}</mxGeometry></mxCell>`;

const has = (list, needle) => list.some((m) => m.includes(needle));
const lacks = (list, needle) => !has(list, needle);

// A long horizontal edge between two boxes, the base most fixtures ride on.
const BASE = box("a", 0, 300) + box("b", 900, 300);

{ // Format check fires on an unprefixed label, and the good control passes.
  const bad = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "", ridingLabel("el", "e", "just some words"))));
  assert.ok(has(bad.errors, "not fully bold"), "format violation must fire");
  const good = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "",
    ridingLabel("el", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads the request"))));
  assert.ok(lacks(good.errors, "not fully bold"), "clean format must pass");
}

{ // Alignment check fires on align=center across a horizontal run.
  const bad = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "",
    ridingLabel("el", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads it", "edgeLabel;html=1;align=center;verticalAlign=middle;"))));
  assert.ok(has(bad.errors, "the crossing axis wants align=left"), "alignment violation must fire");
}

{ // Seating: a label slid far off its run fires, one riding it passes.
  const off = '<mxPoint x="0" y="-200" as="offset" />';
  const bad = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "",
    ridingLabel("el", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads it", "edgeLabel;html=1;align=left;verticalAlign=middle;", 0, off))));
  assert.ok(has(bad.errors, "too far to ride"), "off-run label must fire");
  const good = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "",
    ridingLabel("el", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads it"))));
  assert.ok(lacks(good.errors, "too far to ride"), "riding label must pass");
}

{ // Seating: a vertical run on the label's RIGHT fires.
  const tall = box("c", 300, 0, 4, 4) + box("d", 300, 600, 4, 4);
  const vpin = "html=1;strokeWidth=2;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;";
  const off = '<mxPoint x="-160" y="0" as="offset" />';
  // Both endpoints degenerate would exempt it as a specimen, so give one girth.
  const result = lint(wrap(box("c", 300, 0, 40, 40) + box("d", 300, 600, 40, 40) +
    edge("e", "c", "d", vpin, "",
      ridingLabel("el", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads it", "edgeLabel;html=1;align=center;verticalAlign=middle;", 0, off))));
  assert.ok(has(result.errors, "RIGHT"), "vertical run on the label's right must fire");
}

{ // Remote image is an error; an embedded payload is not.
  const bad = lint(wrap(box("i", 0, 0, 40, 40, "", "shape=image;image=https://example.com/x.png;")));
  assert.ok(has(bad.errors, "remote image"), "remote image must fire");
  const good = lint(wrap(box("i", 0, 0, 40, 40, "", "shape=image;image=data:image/png,AAAA;")));
  assert.ok(lacks(good.errors, "remote image"), "embedded image must pass");
}

{ // Editor junk: a <font color> wrapper fires the warning.
  const bad = lint(wrap(box("t", 0, 0, 120, 40, "hi&lt;font color=&quot;#000000&quot;&gt;&lt;br&gt;&lt;/font&gt;")));
  assert.ok(has(bad.warnings, "font color"), "font-colour junk must fire");
}

{ // Cell-count guard: a model whose cells mostly fail to parse errors out.
  const idless = Array.from({ length: 12 }, () => `<mxCell vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>`).join("");
  const bad = lint(wrap(idless));
  assert.ok(has(bad.errors, "the model is malformed"), "cell-count guard must fire");
}

{ // Duplicate ids: two cells sharing one id error, unique ids stay quiet.
  const bad = lint(wrap(box("a", 0, 0) + box("a", 300, 0)));
  assert.ok(has(bad.errors, 'cell id "a" is carried by 2 elements'), "duplicate id must fire");
  const good = lint(wrap(box("a", 0, 0) + box("b", 300, 0)));
  assert.ok(lacks(good.errors, "duplicate ids"), "unique ids must stay quiet");
}

{ // A duplicate whose second holder is an <object> wrapper fires too: the
  // wrapper carries the id and the mxCell inside it carries none.
  const wrapped = `<object id="a" label="x"><mxCell style="html=1;" vertex="1" parent="1"><mxGeometry x="300" y="0" width="120" height="40" as="geometry" /></mxCell></object>`;
  const bad = lint(wrap(box("a", 0, 0) + wrapped));
  assert.ok(has(bad.errors, 'cell id "a" is carried by 2 elements'), "wrapped duplicate must fire");
}

{ // Token overflow: an unbreakable token wider than its box notes, and an
  // icon whose caption renders outside its box stays quiet.
  const bad = lint(wrap(box("t", 0, 0, 40, 28, "completeWithdrawTransaction(...)")));
  assert.ok(has(bad.notes, "likely overflowing"), "token overflow must fire");
  const icon = lint(wrap(box("i", 0, 0, 28, 28, "Midnight wallet",
    "shape=image;verticalLabelPosition=top;verticalAlign=bottom;image=data:image/png,AAAA;")));
  assert.ok(lacks(icon.notes, "likely overflowing"), "icon caption must not fire");
}

{ // Overlap: two labels on one seat error; the same labels far apart pass.
  const l1 = ridingLabel("l1", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads the recorded thing", "edgeLabel;html=1;align=left;verticalAlign=middle;", 0);
  const l2 = ridingLabel("l2", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Posts the recorded thing", "edgeLabel;html=1;align=left;verticalAlign=middle;", 0.02);
  const bad = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "", l1 + l2)));
  assert.ok(has(bad.errors, "overlap well beyond"), "certain overlap must fire as an error");
  const l2far = ridingLabel("l2", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Posts the recorded thing", "edgeLabel;html=1;align=left;verticalAlign=middle;", 0.9);
  const good = lint(wrap(BASE + edge("e", "a", "b", PIN_LR, "", l1 + l2far)));
  assert.ok(lacks(good.errors, "overlap well beyond"), "separated labels must pass");
}

{ // Floating connection: a specimen edge is exempt, a real one still warns.
  const spec = box("p1", 0, 0, 1, 1) + box("p2", 200, 0, 1, 1) +
    edge("es", "p1", "p2", "html=1;strokeWidth=2;");
  const specimen = lint(wrap(spec));
  assert.ok(lacks(specimen.warnings, "floating connection"), "specimen float must be exempt");
  const real = lint(wrap(BASE + edge("e", "a", "b", "html=1;strokeWidth=2;")));
  assert.ok(has(real.warnings, "floating connection"), "real float must still warn");
}

{ // Clearance: a run passing 10u from an unrelated shape notes; same-colour
  // furniture (a step circle hugging its own step's edge) stays quiet.
  const near = box("n", 400, 330, 60, 60, "5.", "ellipse;html=1;strokeColor=#7F3C8D;");
  const bad = lint(wrap(BASE + near + edge("e", "a", "b", PIN_LR + "strokeColor=#11A579;")));
  assert.ok(has(bad.notes, "minimum clearance"), "clearance note must fire");
  const own = box("n", 400, 330, 60, 60, "5.", "ellipse;html=1;strokeColor=#11A579;");
  const good = lint(wrap(BASE + own + edge("e", "a", "b", PIN_LR + "strokeColor=#11A579;")));
  assert.ok(lacks(good.notes, "minimum clearance"), "same-colour furniture must not fire");
}

{ // Vacuity: a label-free diagram says its label checks inspected nothing.
  const result = lint(wrap(BASE + edge("e", "a", "b", PIN_LR)));
  assert.ok(has(result.notes, "vacuous, not green"), "vacuity note must appear");
}

{ // Vocabulary from the config: an off-list verb and an off-list subject fire,
  // listed ones pass, and a diagram with no well-formed label says the checks were vacuous.
  const labelled = (text) => wrap(BASE + edge("e", "a", "b", PIN_LR, "", ridingLabel("el", "e", text)));
  const vocab = { verbs: ["Reads", "Posts"], subjects: ["MPC", "dApp"] };
  const bad = lint(labelled("&lt;b&gt;User:&lt;/b&gt;&lt;br&gt;Taps the button"), vocab);
  assert.ok(has(bad.errors, 'verb "Taps" is not in the config'), "off-list verb must fire");
  assert.ok(has(bad.errors, 'subject "User" is not in the config'), "off-list subject must fire");
  const good = lint(labelled("&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads the request"), vocab);
  assert.ok(lacks(good.errors, "is not in the config"), "listed verb and subject must pass");
  const none = lint(labelled("just some words"), vocab);
  assert.ok(has(none.notes, "vocabulary: 0 well-formed edge labels"), "vocabulary vacuity must be named");
  const unconfigured = lint(labelled("&lt;b&gt;User:&lt;/b&gt;&lt;br&gt;Taps the button"));
  assert.ok(lacks(unconfigured.errors, "is not in the config"), "no config means no vocabulary check");
}

{ // labelFormat "off" skips the format check and says so; "strict" is the default.
  const malformed = wrap(BASE + edge("e", "a", "b", PIN_LR, "", ridingLabel("el", "e", "just some words")));
  const off = lint(malformed, { labelFormat: "off" });
  assert.ok(lacks(off.errors, "not fully bold"), "format check must be skipped");
  assert.ok(has(off.notes, "switched off by the config"), "the switch-off must be named");
  assert.ok(lacks(off.notes, "reached the format check"), "a switched-off check is not vacuous, it is off");
  const strict = lint(malformed, { labelFormat: "strict" });
  assert.ok(has(strict.errors, "not fully bold"), "strict must fire");
}

{ // Palette: a cell styled outside the palette warns, a copied one passes
  // whatever its placement tokens, and a diagram with no styled cell is vacuous.
  const palette = ["rounded=0;whiteSpace=wrap;html=1;", "html=1;strokeWidth=2;"];
  const copied = wrap(box("a", 0, 0, 120, 40, "", "rounded=0;whiteSpace=wrap;html=1;spacingLeft=34;") + box("b", 300, 0) +
    edge("e", "a", "b", PIN_LR));
  const good = lint(copied, { paletteStyles: palette });
  assert.ok(lacks(good.warnings, "appears nowhere in the palette"), "placement tokens must not fail the palette check");
  const restyled = lint(wrap(box("a", 0, 0, 120, 40, "", "rounded=0;whiteSpace=wrap;html=1;fillColor=#ff0000;")), { paletteStyles: palette });
  assert.ok(has(restyled.warnings, "cell a: style family"), "hand restyle must warn");
  const empty = lint(wrap(`<mxCell id="bare" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry" /></mxCell>`), { paletteStyles: palette });
  assert.ok(has(empty.notes, "palette: this diagram carries 0 styled cells"), "palette vacuity must be named");
  const unconfigured = lint(restyled === null ? "" : wrap(box("a", 0, 0, 120, 40, "", "rounded=0;html=1;fillColor=#ff0000;")));
  assert.ok(lacks(unconfigured.warnings, "appears nowhere in the palette"), "no palette means no palette check");
}

{ // Wrap note: a single-line box narrower than its line notes, a box with room
  // for another line and a box that fits stay quiet.
  const long = "a line of text that is far wider than its narrow box allows";
  const bad = lint(wrap(box("t", 0, 0, 120, 20, long, "rounded=0;whiteSpace=wrap;html=1;")));
  assert.ok(has(bad.notes, "likely wrapping"), "wrap note must fire");
  const roomy = lint(wrap(box("t", 0, 0, 120, 60, long, "rounded=0;whiteSpace=wrap;html=1;")));
  assert.ok(lacks(roomy.notes, "likely wrapping"), "a box with room for another line must stay quiet");
  const fits = lint(wrap(box("t", 0, 0, 400, 20, long, "rounded=0;whiteSpace=wrap;html=1;")));
  assert.ok(lacks(fits.notes, "likely wrapping"), "a wide enough box must stay quiet");
}

{ // Stack layout: a gap between rows and a short container warn, a hugging stack stays quiet.
  const stack = (rows, height) =>
    `<mxCell id="s" value="" style="swimlane;childLayout=stackLayout;horizontal=1;startSize=40;marginBottom=0;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="200" height="${height}" as="geometry" /></mxCell>` +
    rows.map(([id, y, h]) => `<mxCell id="${id}" value="${id}" style="text;html=1;" vertex="1" parent="s"><mxGeometry y="${y}" width="200" height="${h}" as="geometry" /></mxCell>`).join("");
  const good = lint(wrap(stack([["r1", 40, 30], ["r2", 70, 30]], 100)));
  assert.ok(lacks(good.warnings, "stack"), "a hugging stack must stay quiet");
  const gap = lint(wrap(stack([["r1", 40, 30], ["r2", 80, 30]], 110)));
  assert.ok(has(gap.warnings, "stack row r2 starts at y=80, the previous row ends at 70"), "a row gap must warn");
  const short = lint(wrap(stack([["r1", 40, 30], ["r2", 70, 30]], 90)));
  assert.ok(has(short.warnings, "stackLayout container is 90u tall, its rows end at 100u"), "a short container must warn");
}

{ // Cross-colour crossing: no jumpStyle on either edge warns, a token on either stays quiet.
  const cross = (hStyle, vStyle) =>
    wrap(BASE + box("c", 440, 0, 40, 40) + box("d", 440, 600, 40, 40) +
      edge("h", "a", "b", PIN_LR + hStyle) +
      edge("v", "c", "d", "html=1;strokeWidth=2;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;" + vStyle));
  const bad = lint(cross("strokeColor=#E73F74;", "strokeColor=#3969AC;"));
  assert.ok(has(bad.warnings, "different colours cross"), "a jumpless cross-colour crossing must warn");
  const hop = lint(cross("strokeColor=#E73F74;", "strokeColor=#3969AC;jumpStyle=arc;"));
  assert.ok(lacks(hop.warnings, "different colours cross"), "a crossing with a jump must stay quiet");
  const same = lint(cross("strokeColor=#E73F74;", "strokeColor=#E73F74;"));
  assert.ok(has(same.errors, "same-colour"), "a same-colour crossing stays an error");
}

{ // Unlabelled coloured edge notes, a labelled one and a neutral one stay quiet.
  const bare = lint(wrap(BASE + edge("e", "a", "b", PIN_LR + "strokeColor=#E73F74;")));
  assert.ok(has(bare.notes, "coloured (#E73F74) edge carries no label"), "an unlabelled coloured edge must note");
  const labelled = lint(wrap(BASE + edge("e", "a", "b", PIN_LR + "strokeColor=#E73F74;", "", ridingLabel("el", "e", "&lt;b&gt;MPC:&lt;/b&gt;&lt;br&gt;Reads it"))));
  assert.ok(lacks(labelled.notes, "carries no label"), "a labelled coloured edge must stay quiet");
  const neutral = lint(wrap(BASE + edge("e", "a", "b", PIN_LR)));
  assert.ok(lacks(neutral.notes, "carries no label"), "a neutral edge must stay quiet");
}

{ // Working size: content past the advisory budget notes, content within it stays quiet.
  const big = lint(wrap(box("a", 0, 0) + box("b", 1400, 0)));
  assert.ok(has(big.notes, "working size: content spans 1520x40"), "an oversized model must note its size");
  const small = lint(wrap(box("a", 0, 0) + box("b", 600, 0)));
  assert.ok(lacks(small.notes, "working size"), "an in-budget model must stay quiet");
}

{ // Code labels: a bare identifier passes under "identifier" and fails under "call".
  const ident = wrap(BASE + edge("e", "a", "b", PIN_LR, "", ridingLabel("el", "e", "TransactionLedger")));
  assert.ok(has(lint(ident).errors, "not fully bold"), "a bare identifier fails the format check by default");
  assert.ok(has(lint(ident, { codeLabels: "call" }).errors, "not fully bold"), "and under call");
  assert.ok(lacks(lint(ident, { codeLabels: "identifier" }).errors, "not fully bold"), "a bare identifier is code under identifier");
  const prose = wrap(BASE + edge("e", "a", "b", PIN_LR, "", ridingLabel("el", "e", "just some words")));
  assert.ok(has(lint(prose, { codeLabels: "identifier" }).errors, "not fully bold"), "prose with spaces is never an identifier");
}

console.log("lint-violations: all planted violations fired, all controls stayed quiet");
