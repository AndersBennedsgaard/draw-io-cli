---
name: drawio-diagrams
description: >
  Work with draw.io diagrams: read or interpret a .drawio, .drawio.png or
  .drawio.svg file, extract the embedded model, edit diagram XML, render it
  back to PNG/SVG, or create a new draw.io diagram. Use whenever a task
  touches draw.io files (also written drawio or diagrams.net).
---

# draw.io diagrams via drawio-cli

Before any edit, read the style guide at [`../../docs/style-guide.md`](../../docs/style-guide.md)
(relative to this skill file, resolved through any symlink): it holds every rule a
diagram follows, says which verb enforces each one and at which tier, and defines the
project layout a consuming repository commits. Then read the consuming repository's
own `docs/diagramming.md` when it has one: that file holds the project's vocabulary
(colours, verb table, icon table, shapes) and binds on top of the guide. This skill
covers the mechanics only: how to run the CLI, the constraints on moving file content,
and the verification sequence.

The CLI lives at the root of the repository this skill ships in: this skill directory is
`skills/drawio-diagrams/` two levels below that root. Codex's regular-file entry at
`.agents/skills/drawio-diagrams/SKILL.md` loads this shared workflow. Claude Code can
use a symlink under `~/.claude/skills/`. Resolve this shared skill's own directory
(following any Claude symlink), then go up two levels to find the checkout
(`<repo-root>` below). The Codex entry directory is three levels below the root.
Run it as `node <repo-root>/src/cli.js <command>` (or plain
`drawio-cli` if it is on PATH via a project-local link). Before first use in a session, run
`doctor` to check assets, the Playwright package and the browser executable. It does not
launch the browser. Rendering selects `--webapp`, then `DRAWIO_WEBAPP`, then the checkout's
standalone assets, then the VS Code/Cursor extension. An invalid explicit selection fails.
Restore locked dependencies locally with `npm ci --ignore-scripts` and install standalone
webapp assets with `node src/cli.js install-assets` in the checkout when authorised.
The browser, runtime and OS libraries are managed prerequisites. Report missing capability
to the operator. To exercise rendering, run `npm test` in the checkout and inspect the
newest `test/smoke-*-test-result.drawio.png` it leaves behind (gitignored) as an image.

## Hard constraint on helper scripts

Every helper script in this workflow uses the Python or Node STANDARD LIBRARY plus tools
already on the machine. Use the agent's image viewer to inspect rendered output. NEVER install a package
into any global or user-level environment (`pip install`, `pip install --user`, `npm -g`):
if stdlib plus system tools cannot do it, report that as friction instead of installing.

A second hard constraint: file content moves FILE-TO-FILE, never through your own output.
Diagram files carry embedded base64 icon payloads that overflow output-token limits when
retyped: an agent has died mid-task doing exactly that. Copy with `cp`, capture with shell
redirection, and transform with scripts that read the source file and write the destination
file, printing only short confirmations (counts, asserts). Never paste file regions into
heredocs, Edit/Write calls, or your own messages.

A third hard constraint: NEVER call Write, Edit or apply_patch tools on a
`.drawio`, `.drawio.png` or `.drawio.svg` file. Every change goes through a drawio-cli
editing verb or a helper script that reads the file from disk and writes it back. The
file's bytes travel disk-to-disk, and your output scales with the DESCRIPTION of the
change, never with the file. A response that starts emitting diagram XML is already the
failure (a 64k output-token death mid-Write), even when one big Write feels like the
direct path. The Claude Code PreToolUse hook (`hooks/deny-drawio-write.js`, wired
in `~/.claude/settings.json`) enforces this for Claude Code. Codex follows these skill
instructions without that Claude-specific hook. A hook refusal means switch mechanism,
not retry. Typing short NEW cell values (a label, a note's text) inside a small script
is fine. Reproducing existing cells, styles en masse, or payloads is not: script those
from the file itself.

Batch discipline for larger edits: one concern per edit batch (renames, then new rows,
then geometry, then icons, then edges), `lint` between batches, and each of your own
responses stays a few sentences plus tool calls.

## Curated diagrams (NEVER BREAK)

A diagram carrying the curation marker (an inert cell id="curated"; `cells` and `lint`
print a CURATED banner for it, and the marker rides inside a rendered pair's embedded
model too) is under the guide's curated-layout rule: change ONLY the cells the task
names, and prove it mechanically:

- Run `lint` BEFORE your first edit and keep the output. Findings present at baseline
  are the curator's standing decisions: report them if notable, NEVER fix them
  unbidden. After editing, only findings your own edit introduced are yours to fix.
- `cp` the file to your scratchpad before editing, and before finishing run
  `drawio-cli guard-diff <baseline> <edited> --allow <id> [--allow <id> ...]`
  with exactly the ids your task authorised. A nonzero exit means revert the
  trespass, never widen the allow-list to cover it.
- Never remove the marker (`guard-diff` counts that as a violation too). Only the
  curator runs `curate --off`.

`drawio-cli curate <file.drawio>` marks a diagram (idempotent), `--off` unmarks.
After marking or unmarking, re-render the pair so the PNG's embedded model carries
the same state.

## Setting up a diagram project

A repository that has no `drawio.config.json` yet gets the layout the guide's
"Project layout" section defines. Start the palette from the tool's base card with a
plain file copy (`cp <repo-root>/templates/diagram-palette.drawio docs/diagram-palette.drawio`),
render it, write the project's `docs/diagramming.md` holding only its vocabulary,
commit a config with the `lint` section, and run `drawio-cli check-project docs` until
every line reads `ok`.

## Reading a diagram

START with the built-in reports instead of scripting XML dumps:

```sh
drawio-cli cells <file.drawio>          # readable cell table: kinds, absolute geometry, labels, edge routes
drawio-cli cells <file.drawio> --full   # same, with untruncated style strings (exact styles, no XML grep)
drawio-cli styles <palette.drawio>      # named style catalogue from a palette file
```

They replace the exploratory parsing phase entirely: script your own XML analysis only for
questions these do not answer. Edge-label rows (`ELBL`) show the owning edge, the label's
relative position and its offset point: an edge label has no absolute geometry of its own. When a
.drawio is too large to read raw, the bulk is embedded icon payloads:

```sh
drawio-cli extract <file> --elide-images            # full model XML to stdout, payloads as [elided NKB]
drawio-cli extract <file> --elide-images -o dump.xml
```

It accepts .drawio, .drawio.png and .drawio.svg inputs alike. The elided model no longer
renders, so it never lands on the input path. When extracting a reference file from a directory you
must not modify, ALWAYS pass `-o <scratchpad-path>`: the default writes next to the input.

A `.drawio` whose bytes are an SVG or PNG export is refused by every reading and editing
verb: rename it to its true extension or `extract` it.

Never interpret a draw.io PNG from pixels. Files saved by the VS Code extension embed the full model:

```sh
drawio-cli extract <file.drawio.png>     # or .drawio.svg; writes <file>.drawio XML
```

The XML gives every cell exactly: labels (`value`), containment (`parent` chains into swimlanes),
geometry, styles, and every edge's `source`/`target`. Answer structural questions from the XML,
and use the agent's image viewer on the PNG to judge visual layout. In Codex, use
`view_image` with the rendered file's path. The viewer can display the original PNG
without a separate image-processing command.

## Editing or creating

0a. Check for the curation marker FIRST (the `cells` banner): a curated diagram is
   under the surgical rules above, baseline copy and `guard-diff` proof included.
0. For geometry, waypoints and label offsets, prefer the in-place editing verbs over hand
   regex surgery. They splice the file's own bytes (serialisation preserved), verify the
   parsed result, and fail loudly on a missing or duplicate id:

```sh
drawio-cli set-geometry <file.drawio> <id> --x 24 --width 208    # any of --x/--y/--width/--height
drawio-cli set-waypoints <file.drawio> <id> "1090,193 1090,160"  # "" clears them
drawio-cli set-label-offset <file.drawio> <id> -78 0
drawio-cli seat-label <file.drawio> <label-id> --segment 2       # centre a label on one pinned segment's midpoint
drawio-cli fit-box <file.drawio> <id>                            # size a box to its rendered ink (fresh sibling needed)
```

   `seat-label` does the arithmetic the guide's "How a label is seated" paragraph
   describes, so never compute a label's position or offset by hand.

   Values are written verbatim: geometry x/y are PARENT-RELATIVE model units (the `cells`
   table prints absolute positions, so subtract the parent chain before setting). After any
   edit batch, re-render the pair.
0b. Concurrent-editor guard: hash the target `.drawio` before and after every
   edit batch, and re-check just before finishing. An open draw.io editor can re-serialise
   the file under you (cell order rewritten, waypoints collapsed) and a stale buffer can save
   over finished work. Compare the post-edit hash with the final hash to detect an
   intervening write. Node's standard library supplies portable SHA-256 hashing.
   From the checkout root, this example hashes the architecture source. Replace its
   final argument with the target diagram's path:

```sh
node -e 'const fs = require("node:fs"), crypto = require("node:crypto"); console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' docs/architecture.drawio
```
0c. `drawio-cli diff-cells <a> <b>` compares two models cell-level (ids, values, styles,
   geometry excluded). A style delta confined to exit/entry anchor tokens is named
   "edge re-anchored", the silent way an inherited edge's route breaks byte-identity.
   `diff-cells <copy> <source> --subset` is the copy proof: a flow copied from a library
   or an actor map passes when every shared cell matches and nothing exists only on the
   copy's side, and the exit code says so.
1. Edit the `.drawio` XML directly (or author fresh XML: `<mxfile><diagram><mxGraphModel>...`).
2. Every edge MUST reference `source` and `target` cell ids. Free coordinate polylines break
   silently on the next layout edit.
3. Keep labels plain text. HTML-markup labels export as foreignObject and degrade outside draw.io.
4. To restyle consistently, copy style strings from the palette card rather than
   inventing new ones. With `lint.palette` in the config, a hand-styled cell warns.
5. XML landmines that make the webapp silently load ZERO cells (the render guard catches both
   and names them, but avoid them up front):
   - A cell id that collides with a webapp builtin. `id="map"` is confirmed poison. Use
     hyphenated descriptive ids (`event-map`, `target-fn`) and never bare builtin-ish names
     (`map`, `filter`, `target`, `constructor`).
   - Single-quoted attribute values. Valid XML, rejected anyway. Always emit double-quoted
     attributes and escape inner quotes as `&quot;` (beware `xml.sax.saxutils.quoteattr`,
     which switches to single quotes when the value contains `"`).
6. A `dashed=1` text shape renders as a borderless note, the intended look for behaviour notes.
7. Round-trip comparisons use raw extraction from PNG or SVG, with neither
   `--decode-entities` nor `--elide-images`. Parse the source and extracted XML and compare
   cell ids, parsed labels, styles, connections, geometry and waypoints. Account for
   omitted zero-valued coordinates. The webapp can change serialisation and document
   metadata, so byte equality and greps of entity spellings do not prove preservation.
   `check-pair` does exactly this comparison for a committed pair.
   Optional `--decode-entities` preserves numeric tab, line-feed and carriage-return
   references so XML parsing retains multiline attribute values. Safe numeric characters
   such as apostrophes are decoded for readability.

## Rendering

```sh
drawio-cli render <file.drawio> --png            # default: also what READMEs should embed
drawio-cli render <file.drawio> --png --svg      # svg only when explicitly needed
drawio-cli render <file.drawio> --page <name|i> --scale <n> --border <n>
```

- The exported PNG embeds the model (a `tEXt` chunk keyed `mxfile`), so it stays editable in the
  VS Code extension. Commit the `.drawio` source and the rendered `.drawio.png` together.
- Do NOT embed draw.io SVG exports in READMEs: they carry theme-adaptive CSS (`light-dark(...)`)
  and render half-inverted in dark-mode GitHub and VS Code previews. PNG renders identically
  everywhere.
- Scale and border resolve as: explicit flag, then the nearest `drawio.config.json` searched
  upward from the input file, then built-in defaults (scale 3, border 10). In a repository
  that commits a `drawio.config.json`, render WITHOUT `--scale`/`--border` so the committed
  settings apply, and change resolution by editing that file, not by passing flags.

## Verify after every render

0. `drawio-cli lint <file.drawio> [<more.drawio> ...]` FIRST, before rendering. It applies
   the nearest config's `lint` section (announced on stderr as `config: <path>`, and the
   `lint.files` entry that matched the diagram when one did), takes `--config <path>` to
   name one, `--no-config` for the universal checks alone and `--palette <path>` to check
   style families against another card (the config's palette path resolves against the
   config file, so a trial copy elsewhere is otherwise checked against the committed
   card), and aggregates the exit code over several inputs. Read every `note:` line lint prints.
   Notes never fail the run because only an eyeball can judge them. For each note either
   fix the geometry or confirm the layout is forced by an anchor rule (anchors always
   win); never just ignore the line. A note that says a check was "vacuous, not green"
   means that check's input set was empty: treat it as a gap in coverage, not as a pass.
   A warning is a textual, exact finding (a thin edge, a floating connection, editor-
   injected CSS, a hand-styled cell): `--strict` fails on it, so strip or fix it.
0b. For padding and box-hug questions, measure the rendered pixels instead of squinting:
   `drawio-cli measure <file.drawio.png> --cell <id>` reports each cell's ink extents and
   per-side padding in model units, with a calibration line carrying its own error bar.
   Calibration folds estimated edge-label boxes into the content bounds (labels are the
   usual reason an export outgrows the geometry), a residual explained by bound-setting
   EDGES demotes to a note, a scale that cannot match the PNG fails loudly with the
   implied scale named, and `--affine` prints the model-to-pixel mapping but REFUSES while
   a live calibration WARNING stands. The affine changes whenever an edit moves the model
   bounds: re-read it after every render, never cache it across edits. Passing a container
   or group id reports every vertex child too, and `--gaps <container-id>` reports each
   child's clearance to the container's sides plus the largest empty rectangle inside it
   (the dead-space question in one line). Passing an edge label's id measures its TEXT box
   (align-aware) with foreign ink named separately, and appends a `visible run` line: how
   many units of the edge's own run stay visible on each side of the knockout, under 20u
   flagged as an orphaned stub. `--fit <id>` peels a stroked shape's border before sizing
   and names any declared spacing tokens the delta restates.
0c. After rendering a diagram whose actor boxes embed icons, run
   `drawio-cli measure <file.drawio.png> --icon-gaps`. It sweeps every labelled box
   containing an image cell, reports the clear gap between the icon's rendered ink and
   the first glyph in model units, flags pairs under the guide's minimum (8u, tune with
   `--min-icon-gap`), and exits nonzero on any flag. A saturation line means the gap could
   not be measured: judge that pair by crop before believing either way. A "vacuous, not
   green" line means the model holds no icon+text pairs, so the sweep proved nothing. Fix
   a flagged pair by widening its box, then re-render and re-run until the sweep exits clean.
0d. `drawio-cli crop <file.drawio.png> --region x,y,w,h` cuts a region given in MODEL
   units out of the render through the same calibration `measure` uses, so a close look
   at one cell never needs pixel arithmetic by hand. The calibration's residual, when
   one stands, is named as the crop's error bar.
1. Open the PNG with the agent's image viewer. Check labels, arrows, and that no broken-image
   placeholders appear. Use `crop` for close inspection and keep the full image available
   to check overall layout. Whether a jump hop renders (it renders on the edge declared
   LATER in the file) and z-order (an icon declared before its box renders invisible) are
   visible only here. A render that the exporter would clamp to its canvas limit is
   refused up front with the scale that fits: lower `render.scale` in the config or split
   the diagram, never pass an ad hoc flag.
2. `drawio-cli check-pair <file.drawio>` proves the rendered sibling carries the source's
   model (values compared decoded, geometry rounded), and `drawio-cli check-project <dir>`
   proves the whole layout: config, palette, project guide and every pair fresh.
3. If the target repository defines further checks (in its AGENTS.md or a check script),
   run them before finishing.
