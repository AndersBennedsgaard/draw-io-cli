# Backlog

Ordered by priority. Every item comes from drawing real diagrams with this tool in a
consuming repository: an agent session hit the gap, or a reviewer confirmed it. An item
is done when its definition of done has been executed and observed, and every new
check has a planted violation seen firing beside a clean control.

- [x] `render` refuses a clamped export, and `check-pair` detects one
  - done: `predictedExportSize` folds labels and captions into the bounds, `render` refuses before rendering and again on a PNG sitting on the 16384px limit, `pairVerdict` reads such a sibling as clamped. Smoke and project suites.
  - category: bug (silent false pass), reproduced on a 7296-unit-tall library: the
    exporter shrank the PNG to fit its canvas limit, printed nothing, and `check-pair`
    read the embedded model as fresh.
  - description: after a render, compare the PNG's pixel size with the size the model
    bounds predict at the configured scale and border. A shortfall beyond the border's
    own slack means the exporter clamped the canvas: fail, naming the predicted and
    actual sizes and the scale that would fit. `check-pair` runs the same comparison on
    the committed sibling, so a clamped PNG reads as stale.
  - definition of done: rendering an oversized model exits 1 with both sizes named and
    writes nothing, a model within the limit renders as before, and `check-pair` on a
    clamped sibling exits 1 naming the mismatch.
  - test: smoke-suite render of a tall fixture asserting the refusal, and a project-suite
    synthetic pair whose PNG is smaller than its model predicts.

- [x] `check-project` lints every source
  - done: one `lints with N error(s), M warning(s)` line per source under its path's vocabulary, failing on errors. Project suite.
  - category: feature (CI enablement), found by two agents: a pair with ten lint errors
    reported `ok` because the layout check proves freshness only.
  - description: for every `.drawio` under the tree, run lint with the config's
    vocabulary and print one line with the error and warning counts, failing on errors.
  - definition of done: a tree holding a source with a lint error fails with that
    file's counts on its line, and a clean tree passes with counts shown.
  - test: project-suite variant with a planted lint error, and the conforming fixture
    asserting its counts line.

- [x] `measure` attributes caption overhang and keeps `--affine` usable
  - done: `fullBounds` adds caption boxes with the webapp's label padding, a residual on an axis bounded by an edge or an estimate is an attributed note, the threshold is one stroke width per bound, and `--affine` prints under a warning with the residual as its error bar. Measure suite.
  - category: bug (usability), reproduced on every diagram carrying an icon caption: the
    calibration warning fired on every render and never cleared, so `--affine` refused
    and both agents computed crop offsets by hand.
  - description: a caption rendered above or below an image cell
    (`verticalLabelPosition`) extends the export bounds past the geometry. Fold the
    estimated caption box into the predicted bounds the way edge labels already are,
    so the residual drops under the slack, and let `--affine` print the mapping with the
    residual as its stated error bar instead of refusing.
  - definition of done: the palette card measures with no calibration warning, and
    `--affine` prints on a diagram whose residual stands, naming the error bar.
  - test: icon-gaps-suite synthetic render with a captioned icon asserting no warning,
    and an args-suite case asserting `--affine` prints under a residual.

- [x] `seat-label` verb and documented label mechanics
  - done: `seat-label` writes the arc-length position and the align-aware offset, the guide has "How a label is seated". Args suite.
  - category: feature, found by an agent that read `lint.js` to learn that a label's
    geometry x is an arc-length position in -1..1 and that `align=left` hangs the text
    to the right of its anchor.
  - description: `seat-label <file.drawio> <label-id> --segment <k>` sets the label's
    relative position to the midpoint of the parent edge's k-th pinned segment and its
    offset so the estimated text box is centred on the run (`align=left` gets minus half
    the estimated width, `align=center` gets zero). The guide and the skill state the
    mechanics.
  - definition of done: after `seat-label`, lint's seating check passes for that label
    on a horizontal and on a vertical run, and the guide has a "How a label is seated"
    paragraph.
  - test: args-suite case on a two-segment fixture asserting the written x and offset
    and a clean lint seating result.

- [x] Lint: note a line that wraps
  - done: a line estimated wider than its box notes when the box has no room for another line. Lint-violations suite.
  - category: lint rule, found by an agent: a row too narrow wrapped its last line out
    of sight under `overflow=hidden`, and lint only flags unbreakable tokens.
  - description: for a vertex with a value, geometry and `whiteSpace=wrap`, estimate
    each rendered line's advance against the width minus the side spacing, and note a
    line that does not fit. Captions on image cells are exempt.
  - definition of done: a box narrower than its longest line notes it, a box that fits
    stays quiet.
  - test: planted violation plus control in test/lint-violations.mjs.

- [x] Per-file lint vocabulary and a configurable code-label pattern
  - done: `lint.files` entries with globs, `codeLabels` at either level, the applied entry announced. Args and lint-violations suites.
  - category: design, found by two agents: one global `labelFormat`, `verbs` and
    `subjects` cannot serve a state machine and an action flow in one repository, and
    a bare interface name can never be a code label.
  - description: `lint.files` in the config is a list of `{ match, labelFormat, verbs,
    subjects, codeLabels }` entries matched by path relative to the config file (`*`
    and `**` globs), the first match overriding the top-level values. `codeLabels` is
    `call` (today's behaviour) or `identifier` (a bare identifier or a call).
  - definition of done: two fixtures under one config lint with different vocabularies,
    and a bare identifier label passes under `identifier` and fails under `call`.
  - test: args-suite cases with a config carrying two file entries.

- [x] `diff-cells --subset` as the copy proof
  - done: `subsetCells` reports matched, extra and differing cells with the exit code on the violations. Args suite.
  - category: feature, found by a reviewer: the documented proof that a flow copies its
    cells from the library exits 1 whenever membership differs, which is always.
  - description: with `--subset`, ids only on the second side are fine, ids only on the
    first side are listed as violations, and a shared id must match in value and style.
    The exit code follows the violations.
  - definition of done: a flow holding a true subset of the library exits 0 naming the
    matched count, and a flow with a re-authored cell or an extra cell exits 1 naming it.
  - test: args-suite cases over a library fixture and three copies.

- [x] `fit-box` applies the measured fit to the file
  - done: `measure` collects fits, `fit-box` writes the implied width and height and refuses a missing or stale sibling. Measure suite.
  - category: feature, found by an agent: `measure --fit` says what the box should be,
    and applying it took three render-and-measure rounds by hand.
  - description: `fit-box <file.drawio> <id>` reads the rendered sibling, computes the
    box `--fit` reports, and writes its width and height with the geometry editor,
    refusing when the sibling is missing or stale.
  - definition of done: one invocation on an oversized box leaves the geometry the
    `--fit` line reported, and a stale sibling is refused.
  - test: args-suite case over a synthetic pair.

- [x] Lint: stack-layout containers hug their rows
  - done: rows contiguous from `startSize`, container height the last row's bottom plus `marginBottom`, warning tier. Lint-violations suite.
  - category: lint rule, found by a reviewer: a stack container's height and row
    positions are authored blind, since the layout is not recomputed at render.
  - description: for a container with `childLayout=stackLayout`, each child's y must
    follow the previous child's bottom starting at `startSize`, and the container's
    height must equal the last child's bottom plus `marginBottom`. Warning tier.
  - definition of done: a gap, an overlap or a short container warns naming the cell,
    a correct stack stays quiet.
  - test: planted violation plus control in test/lint-violations.mjs.

- [x] `lint --palette` override and the palette path rule documented
  - done: `--palette <path>` for one run, the README and skill state the config-relative rule. Args suite.
  - category: usability, found by an agent: linting a trial copy with `--config` checked
    styles against the committed palette, since the palette path resolves against the
    config file, and produced ten false warnings.
  - description: `--palette <path>` overrides the config's palette for one run, and the
    README and skill say the config's palette path is relative to the config file.
  - definition of done: a trial copy lints clean with `--palette` pointing at itself.
  - test: args-suite case.

- [x] Smoke suite green on every webapp
  - done: the landmine case asserts the guard when the webapp drops the model and the carried cell when it does not, so neither outcome is a free pass. Seen green under the hediet 1.17.0 assets.
  - category: tests, reproduced: the `id="map"` landmine renders fine under the
    hediet 1.17.0 extension assets, so `npm test` fails at baseline on a laptop with that
    extension and no standalone assets.
  - description: find the landmine that still kills every supported webapp, or assert
    the render guard through a fixture whose cell count genuinely drops, and keep the
    lint check for poison ids as the static guard.
  - definition of done: `npm test` passes with the extension assets and with the
    standalone assets.
  - test: the smoke suite itself.

- [x] Lint: cross-colour crossings must carry `jumpStyle=arc`, and the hop's edge is named
  - done: a jumpless cross-colour crossing warns naming both edges, the guide states the hop renders on the edge declared later. Lint-violations suite.
  - category: lint rule, hit on both drawn diagrams: hops were placed by eye, and the
    first render showed none because the token sat on the edge declared earlier.
  - description: a proper crossing of two different-colour edges where neither carries
    `jumpStyle` warns naming both edges, and the guide states that the hop renders on
    the edge declared later in the file.
  - definition of done: a jumpless cross-colour crossing warns, a crossing with the
    token on either edge stays clean, and the guide carries the declaration-order fact.
  - test: planted violation plus control in test/lint-violations.mjs.

- [x] Lint: note an unlabelled coloured edge
  - done: note tier, neutral and labelled edges quiet. Lint-violations suite.
  - category: lint rule, hit on the state machine: its terminal edges went unlabelled
    under a rule conflict and nothing said so.
  - description: a non-black edge carrying no child label cell produces a note, never a
    failure, since a bundle segment continuing a labelled arrow is legitimate.
  - definition of done: an unlabelled coloured edge notes, a labelled one stays quiet.
  - test: planted note plus control in test/lint-violations.mjs.

- [x] Lint: advisory working-size note
  - done: note naming the content size past 1300 by 800. Lint-violations suite.
  - category: lint rule, hit on the library (six times the budget) and the deleted
    component map (four times): nothing named the overrun.
  - description: when the model bounds exceed the 1300 by 800 advisory budget, note the
    actual size. Never fails the run.
  - definition of done: an oversized fixture notes its dimensions, an in-budget one
    stays quiet.
  - test: planted note plus control in test/lint-violations.mjs.

- [x] Command: `crop` in model units via the affine mapping
  - done: `crop --region x,y,w,h` through `calibrate`, refusing only a residual larger than the region. Measure suite.
  - category: feature, hit by both agents, who computed `sips` crop offsets by hand.
  - description: `crop <file.drawio.png> --region x,y,w,h` in model units, mapped to
    pixels through the calibration, writes a PNG, and refuses only when the residual is
    larger than the region itself.
  - definition of done: cropping a known cell's region yields a PNG whose dimensions
    match the affine prediction exactly.
  - test: smoke-suite crop of a rendered fixture asserting output dimensions.
