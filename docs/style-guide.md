# Diagram style guide

Every diagram drawn with drawio-cli follows the rules on this page. Where a rule is
mechanical, `lint`, `measure`, `check-pair` or `guard-diff` enforces it and the rule
says so in brackets, with the tier: an error fails the run, a warning fails it under
`--strict`, and a note never fails the run and asks for an eyeball. Where a rule is a
judgement, the bracket says `(eyeball)` and the render is inspected before the work
is called done. A repository adds its own vocabulary on top of this page (its colours,
its verb table, its icons, its shapes) in a project style guide, and never restates
what this page says.

## Project layout

A repository that commits diagrams commits this layout, and `drawio-cli check-project
<dir>` verifies it line by line:

| File | Required | Purpose |
|---|---|---|
| `drawio.config.json` at the repository root | yes | render settings and the `lint` section, found by upward search from each diagram, one per repository |
| `docs/diagramming.md` beside the config | yes | the project's vocabulary only: colour meanings, verb table, icon table, shape vocabulary, membership rules, with a link to this guide for everything generic |
| `docs/diagram-palette.drawio` plus `.drawio.png` | yes | the copy-source card, named by `lint.palette` in the config and started from the tool's base palette (`templates/diagram-palette.drawio` in this repository) |
| `docs/diagram-assets/` | when custom icons exist | the icon bank, pre-sized, embedded into diagrams as base64 |
| `<name>.drawio` plus `<name>.drawio.png` | per diagram | the committed pair, anywhere under the repository, each governed by the config above it |
| `AGENTS.md` | one bullet | names `docs/diagramming.md` as binding and restates nothing |

The config's `lint` section carries the vocabulary the checks need:

```json
{
  "render": { "scale": 3, "border": 10 },
  "lint": {
    "labelFormat": "strict",
    "verbs": ["Reads", "Posts"],
    "subjects": ["MPC", "dApp/relayer"],
    "palette": "docs/diagram-palette.drawio"
  }
}
```

`labelFormat` is `strict` (the default) or `off`. `verbs` and `subjects` are optional
lists an edge label's body verb and first line must come from (lint, error).
`codeLabels` is `call` or `identifier`, saying whether a bare identifier counts as a
code label. `palette` names the copy-source card, relative to the config file, and
every styled cell's style family must appear on it (lint, warning). A `files` list
gives per-file vocabulary: each entry's `match` is a glob relative to the config file
and its other keys override the top-level ones for the diagrams it matches, so a
state machine and an action flow in one repository each lint under their own grammar.
A check whose list is absent is simply not run, and `lint --no-config` runs the
universal checks alone.

## File format

A diagram is a committed pair:

- `<name>.drawio`: the XML source of truth. Text, so PR diffs show which labels and
  edges changed.
- `<name>.drawio.png`: what READMEs embed, rendered from the source. The render embeds
  the model in the PNG, so the PNG alone stays openable and editable in VS Code's
  draw.io extension.

Render settings live in the repository's `drawio.config.json`. Resolution changes are
edits to that file (`render.scale`), re-rendering every pair in the same change. The
pair moves together: re-render after every source edit, and commit both (check-pair,
error). Draw.io SVG exports depend on the viewer's theme and render broken in dark
mode, so READMEs embed the PNG and never an SVG.

A `.drawio` holds draw.io source XML. An export saved under that name (an SVG, a PNG)
is refused by every reading and editing verb, since a reader that inspected it as
source would find zero cells and pass (lint, error).

Never hand-export from the draw.io UI, screenshot, pass ad hoc scale or border
overrides, commit a PNG not rendered from the `.drawio` source beside it, leave an edge
without `source` and `target` attachments, or embed a draw.io SVG export in docs.

## Visual weight is semantics

Each visual channel carries exactly one meaning, and nothing else uses that channel.
The project style guide says what each channel means in its diagrams. The default
assignments, which the base palette carries:

- **Colour means a step or phase.** Everything that belongs to one step (the numbered
  circle and every arrow of that step) uses that step's colour, and nothing else does.
  Everything else stays neutral: default black strokes on a white background, lanes and
  shapes unfilled.
- **Dotted outlines mark connectable nodes.** State, operations and behaviour
  responsibilities render in dotted-border boxes, and edges anchor only to nodes
  (outlined boxes, icons, hexagons, actor boxes, lanes). Borderless text is annotation:
  it rides an edge and never takes an arrow.
- **Bold marks the greppable name.** In prose (edge labels, notes), the verbatim names
  that grep in source are bold, plus exactly two structural classes: an edge label's
  subject prefix and a note's colon-led keywords. Nothing else is bold, verbs
  included: bold text is the visible anchor tying the diagram to the code, and the two
  structural classes are the scaffolding around it.
- **Arrow flow marks sequence.** When one lane performs an ordered sequence within a
  step, the sequence is drawn as edges threading through its boxes in the step's
  colour, entering the first box and leaving the last toward its destination. Boxes
  with only sideways edges hide their order.
- **Broad dashes mark derivation machinery.** Derivation notes and identity nodes carry
  a broad-dashed border (`dashed=1;dashPattern=12 12`), and every derivation edge is a
  broad-dashed line (`dashPattern=8 8`, `strokeWidth=2`). Nothing else uses broad
  dashes: a cluster's plain dashed rectangle and the dotted node borders stay visually
  distinct from it.

## Labels

- Prose labels use the default font (Helvetica).
- Code labels render as code: Menlo/Monaco monospace at 12px, the keyword in a keyword
  colour, the identifier in near-black. Copy the sample cell from the palette card.
- **Truth priority: code > docs > diagram.** When a term exists in more than one place,
  a label takes it from the leftmost source that has it: names come from the source
  code, step phrasing from the documentation, and a diagram invents wording only where
  neither has any. A label is correct iff it greps in the source (eyeball).
- **Every bit of text directly associated with an edge IS an edge label.** Whether it
  rides the edge or would sit beside it, arrow-associated text is authored as a label
  riding that edge and follows the golden rules below, the strict format included.
  Free-standing text shapes beside an arrow are forbidden. Every arrow DESCRIBES
  itself: each logical arrow carries a label saying what happens along it (a run drawn
  as one edge carries one label, and a bundle segment that merely continues an
  already-labelled arrow of the same step adds nothing). A code label (whole text a
  call expression) satisfies this on its own where the call IS the action. An
  unlabelled arrow is a defect: the reader must never have to infer an arrow's action
  from its endpoints alone (lint, note on a coloured edge with no label).

### Edge-label golden rules (NEVER BREAK)

Edge labels are the diagrams' descriptions, and these rules hold ALWAYS: follow them no
matter what, growing the diagram until they fit (the golden precedence in the
working-size section).

- **The run passes through the label's centre**: a horizontal run through the label's
  vertical midpoint, a vertical run through its horizontal midpoint, the background
  knockout breaking the line behind the text. The ONE exception: when the run is too
  short for the label to cross it, the label sits alongside as close as possible, and
  the run then passes on the label's LEFT (vertical run) or its top or bottom
  (horizontal run), never its right (lint, error).
- **The knockout hugs the text, and the run survives it**: the break a label makes in
  its run covers the text ink plus a small margin and never the label box's empty
  padding, and visible line remains on BOTH sides of the break. An arrowhead sitting
  straight on the text, or a stub too short to read as a line, means the run is too
  short for the label it carries: grow the gap between the shapes the run joins until
  the line reads (the golden precedence), and never shrink the label or slide it off
  its run instead. Keep the run's own furniture clear of the break too, since a step
  circle beside the last few units of a stub leaves no clean line to read. A label on
  a vertical run is free to slide ALONG it to find that clean space, its horizontal
  centring being the part the seating rule fixes (measure, the `visible run` line,
  under 20 units flagged).
- **Alignment follows the crossing axis**: `align=left` when the run crosses the label
  horizontally, `align=center` when the run is vertical, the alongside case included
  (lint, error).
- **The edge starts at the initiator**: the source is the party performing the action,
  the arrowhead lands on the acted-upon. A read points AT the thing read (eyeball).
- **Strict label format**: the first line is the subject of the arrow, bold and
  colon-terminated, and the body starts with a capitalised verb. On a flow diagram the
  subject is the acting party (an actor, a lane, an operation). On a state diagram it
  is the trigger or the guard outcome. The body's verb comes from the project's verb
  table, and verbs stay normal weight: bold remains reserved for the subject prefix and
  the greppable names. The label cell's copy source is the palette card's edge-label
  section, which seats the format on a horizontal run and on a vertical one (lint,
  error, with the verb and subject lists from the config when it carries them).
- **Label texts never overlap one another** (lint, error beyond the estimate's error,
  note on a graze).

#### How a label is seated

An edge label has no geometry of its own. Its `x` is a position along its edge's pinned
polyline, arc length mapped to -1 at the source and 1 at the target, and its offset
point shifts the anchor that position gives. The text hangs off the anchor by its
alignment: `align=center` centres it, `align=left` puts the text's LEFT edge on the
anchor so the label needs an offset of minus half its width to sit centred, and
`align=right` the mirror. `verticalAlign=middle` centres the text vertically on the
anchor, anything else hangs it a few units below. `drawio-cli seat-label <file> <id>
--segment <k>` writes the position and offset that centre the estimated text box on
the midpoint of segment k, after which the seating check reads the label as riding
its run.

Two narrow exemptions, and only these: a label whose WHOLE text is a call expression
(`transfer(vaultAddress, amount)`) is a code label, exempt from the format rule. A
label on a specimen edge (both endpoints degenerate points of 4 units or smaller, the
palette card's swatch construction) is a legend caption naming the style it
demonstrates, exempt from the format and alignment rules: the seating rule still
applies to it, a legend caption riding its swatch crookedly is a defect on a copy-source
card.

### One verb, one meaning

Everywhere an edge label or note describes an action, one verb has one meaning. The
project style guide holds the table: verb, who says it, what it means exactly. When no
row fits an action, the table extends: a new verb lands as one row there, in the same
change as its first label, and in the config's `lint.verbs` list when the project
keeps one, keeping one verb one meaning.

## Shapes

- **Boxes hug their content with ONE uniform padding.** A node box's border keeps
  exactly 8 units of padding at the sides and 6 above and below the text (a
  single-line code cell is 28 units tall), so an anchor on the box edge is an anchor on
  the content. Roomier reads as emptiness, tighter reads as clipping, and every sibling
  box in a column carries the identical padding so the column reads as one family. An
  arrowhead that visibly stops short of the text means the box is too big, not the
  arrow too short (measure `--fit` reports the box, `fit-box` writes it, and lint notes
  a code box far wider than its text).
- **A line never wraps out of sight.** Under `whiteSpace=wrap` a line wider than its
  box wraps, and under `overflow=hidden` the pushed-down last line vanishes. A box is as
  wide as its longest line plus its padding, judged on the render (lint notes a line
  estimated wider than a box with no room for another line).
- **A stack-layout container hugs its rows.** The webapp recomputes nothing at render,
  so each row of a `childLayout=stackLayout` container starts where the previous one
  ends, from the header's `startSize`, and the container's height is the last row's
  bottom plus `marginBottom` (lint, warning).
- **Text sits visibly centred in its box**: node cells carry `verticalAlign=middle`
  with the uniform padding, so a `0.5` side anchor meets the text centre and the border
  frames the text evenly. Verify the centring in the render, never only in the XML.
  Copy the cell from the palette card, which carries these values (eyeball).
- **Actor and app boxes** are plain rectangles (`rounded=0`, bold) with the actor's
  icon embedded INSIDE the box, so the box reads as a component. The icon's placement
  follows the box's height, and the height follows what the box has to serve:
  - **Beside the text** where the box hugs its label. The icon sits 12 units in from
    the left and is vertically centred, `spacingLeft` clears the text past it (34 units
    for a 26-unit icon), and 12 units of padding surround the pair: an actor box is no
    taller or wider than that. This is the default.
  - **Above the text** where edges anchor to the box at fractions of its height and
    force it taller than its label needs. Filling that height beside the text strands
    the remainder as dead space, so the icon goes on the horizontal centre line with
    `spacingTop` dropping the text clear beneath it.

  Either way the icon and text read as ONE unit centred on both axes, and the unit is
  what gets centred, never the icon and the text apart. Whatever the cell constants
  give, at least 8 model units of clear space separate the icon's rendered ink from the
  first text glyph, judged on the RENDER and never on cell geometry alone, since icons
  fill their cells unevenly (measure `--icon-gaps`, exit 1 under the minimum). A gap
  that comes up short is fixed by widening the box, as width is what buys the gap under
  centred text: the icon never shrinks and the text never slides off its centring. Two
  cautions when placing it: centre the icon on its rendered INK, not on its cell box,
  since an embedded PNG usually carries uneven transparent padding, and `spacingTop`
  does not move the text one-for-one, so set it by measuring the render rather than by
  arithmetic.
- **Lane headers** show ONE centred unit: the lane's icon, a small gap, then the bold
  title, centred horizontally and vertically in the header band. The lane cell's own
  value stays empty: the unit is a group (icon + title text) copied from the palette
  card and centred at the lane's midpoint. A lane whose logo includes its wordmark uses
  the logo alone as the unit.
- **A lane's width is minimised**: just wide enough that reasonable padding (15 units
  or more) separates the lane's widest content from the border. Dead space is the
  defect: shrink the lane rather than stretching content to fill it, and keep one
  vertical rhythm inside a lane, the gap between a cluster and the notes below it
  matching the note-to-note gap (eyeball).
- **Dotted-bordered text boxes** (`dashed=1;dashPattern=1 2;strokeColor=default`) hold
  behaviour responsibilities: they are nodes and edges land on them. Sibling
  responsibilities share one colon-led scaffold (`Signs: <object> With: <instrument>`)
  and their boxes left-align on ONE shared x, so the opening keywords read as a column
  down the page whatever width each box takes. The greppable instrument is bold. A note
  stacks as many colon-led pairs as the behaviour needs, each keyword bold,
  colon-terminated, opening its own line.
- **Member nodes** (a record's fields, an interface's operations) are grouped cells: a
  dotted-border box, a text-height icon inside it at the left, and the member's code
  text beside the icon, grouped so they move as one. The icon is 16 units tall and is
  the one the project's icon table gives that member kind. The icon sits 8 in from the
  border with a 6-unit gap before the text. The code text opens with the compact
  keyword in the code style's keyword colour, ALWAYS at normal weight: keywords are
  never bold. Bold is reserved for the greppable name, and a keyword is syntax, not a
  name. A record or map type is a record block: bold type name with its opening brace,
  fields indented beneath, closing brace. A scalar field is its single line.
- **Members stack in vertically separated SECTIONS**, in an order the project fixes.
  The gap between sections is visibly larger than the row gap inside a section, one
  consistent section gap per diagram, so the grouping reads without labels.
- **A node's behaviour is a bullet list inside that node's dotted box**, never a
  separate floating note.
- **A dashed no-fill rectangle** marks an actor cluster: it draws a visible dashed
  outline around the shapes that act as one party.
- **Hexagons hug their two-row label** (a kind word over the bold name): the text is
  centred on both axes, the sloped sides run at 45 degrees (`fixedSize=1` with `size`
  equal to half the hexagon's height), and the hexagon is sized so the text clears the
  slopes by the uniform padding and no more. Excess width or height around a centred
  label is dead space, and a width-relative slope is forbidden: it forces wide hexagons
  to grow instead of hug.
- **Step circles** (`strokeWidth=2`, font size 20) carry the step number in the step's
  colour.
- **Derivation machinery** renders as a broad-dashed note carrying the abstract call,
  one argument per line, with every argument token that greps in source bold. A root
  key or address that participates in derivation renders as a broad-dashed identity
  node carrying its name in bold. Derivation edges are broad-dashed and every arrow
  points at the thing generated or used: input nodes point INTO the note, and the note
  points at what its call derives.

## Layered composition (NEVER BREAK)

A diagram is composed in layers, and each layer must stand on its own:

1. **Layer 1: shapes and their labels.** Boxes, hexagons, icons, notes. Composed
   FIRST, as a deliberate arrangement: siblings align on shared coordinates (the
   members inside a box stack at one x with even vertical spacing), gaps are
   consistent, icon captions sit above their icons. The test: delete every line from
   the diagram and what remains still looks intentionally placed. A layer-1 item never
   sits somewhere that only makes sense once the lines are drawn (an indented member
   "making room" for an edge is a defect: the edge routes around, the member stays in
   its column) (eyeball).
2. **Layer 2: lines and step circles.** Routed around layer 1 per the edge rules
   below. A numbered circle sits at touching distance from its step's MOST SALIENT
   edge, the one a reader would name as "the step happening". The salient edge is the
   acting actor's own call edge, never a downstream edge of the same colour. When no
   edge is obviously more salient than its siblings, use the step's first edge at its
   source shape. Never floating in whitespace, never equidistant between two steps
   (eyeball).
3. **Layer 3: line text.** Edge labels annotate layer 2 without colliding with either
   layer (lint, note when a run crosses an estimated label box).

## Captions and anchors

- **An icon's caption sits above the icon, centred** (text before image), everywhere:
  actors, servers, chains, the lot.
- **Edges anchor at the centre of the side they meet** (`0.5` on that axis). Never
  anchor at or near a corner of a text or image bounding box. On a shape taller than
  one line of text an off-centre anchor is allowed, but it keeps clear padding from the
  shape's edge, never hugging it.
- **An edge label sits per the golden rules** in the Labels section: centred on its
  run, or legally alongside when the run is too short to cross it. Offsets exist only
  to reach that seat.

## Edge routing (NEVER BREAK)

- **NO diagonal segments, ever.** Every edge is built from strictly horizontal and
  strictly vertical runs joined by clean corners (lint, error).
- **Corners: step edges curve, everything else stays sharp.** Every coloured step edge
  turns its corners as arcs (`rounded=1;arcSize=20`, carried by the palette's step
  swatch: copy the style, never re-author the tokens), so the step lines pop from the
  rectangular structure and the eye follows them immediately. Derivation edges keep
  sharp right-angle corners (`rounded=0`), as do lane borders and every shape. The runs
  themselves stay strictly horizontal and vertical in both cases: only the corner
  turns. The project style guide says which of its edge classes curve.
- **No almost-straight segments, ever.** A run is either perfectly straight or a
  deliberate 90 degree jog. An edge that is off-vertical or off-horizontal by a few
  pixels is a defect, not a route (lint, error).
- **Edges are thicker than lane borders**: every connecting line carries
  `strokeWidth=2` (swimlane borders stay at the default 1), dashed derivation edges
  included (lint, warning).
- **Route around shapes.** An edge crosses another EDGE when it must (prefer a visible
  jump where the crossing is busy), but it never cuts through a shape while a route
  around exists (lint, error). Hexagons set their label as the kind word on the first
  row and the name below it, which keeps them compact enough to route around.
- **Paired right angles align.** When two edges take the same style of corner near
  each other (along, then up, then along), their vertical runs line up on one x
  coordinate, as mirror images or both the same way. Two nearly-aligned verticals are a
  defect (lint, error within 15 units, note for stacked runs out of column).
- **Step lines travel together.** All edges of one step (one colour) that leave the
  same shape anchor at one shared base, or immediately adjacent points on one side,
  and separate with one or two explicit 90 degree jogs. Never scatter a step's edges
  across different sides or distant anchors of a shape when a shared base is possible:
  prefer crossing another step's line over splitting your own step's lines apart.
- **A step never crosses itself, and neither does the neutral layer.** Two edges of
  the same stroke colour must not cross each other, the default black derivation edges
  included: same colour reads as one system, and a crossing inside one system reads as
  a junction. The derivation layer therefore stays planar, consolidating on shared
  trunks and buses where fan-in would force a crossing. When two edges share a source
  shape, order their anchors to match their targets so they fan out without crossing.
  A T-junction off a shared trunk is the sanctioned form of fan-out. Where DIFFERENT
  colours must cross, put `jumpStyle=arc` on the crossing edge so the crossing reads as
  a jump, never as a junction: jumps exist for cross-colour crossings only, never to
  excuse a same-colour one. The hop renders on whichever of the two edges the file
  DECLARES LATER, so the token goes on that edge or the render shows no hop (lint,
  error on a same-colour crossing, warning on a cross-colour crossing with no
  `jumpStyle` on either edge, and whether the hop renders is eyeball).
- **Tails and leads run at least 40 units.** On any edge with a corner, the first
  segment out of the source and the final segment into the arrowhead each run at least
  40 units before bending. A bend hard against a shape reads cramped (lint, error).
- **Arrowheads land in clear space.** No other line passes within 20 units of an
  arrowhead's landing point (the arrow glyph itself occupies real space), and no line
  of the SAME colour passes within 40: an unrelated same-colour line near an arrowhead
  reads as a junction. An arrowhead never sits on another edge: lengthen or reroute to
  make room. Several arrowheads deliberately sharing one anchor point are the allowed
  exception (lint, error).
- **Runs keep clear of unrelated shapes.** A run passing within 20 units of a shape it
  does not connect reads as touching it (lint, note, same-colour furniture exempt).
- **Prefer: corners need a cause.** Every corner should be justified by an obstacle or
  another rule. If sliding an anchor within its side's allowed band removes a corner
  without breaking anything, remove it: straight beats stepped. Review question per
  corner: "what does this corner avoid?" The anchor rules ALWAYS win over
  straightness: never slide an anchor toward a corner of a shape to straighten an edge,
  and a corner caused by keeping a centred or padded anchor is a caused corner.
- **Prefer: same-direction edges share anchors.** Edges leaving or entering one shape
  in the same direction share one anchor point, or a tight cluster on that side: at
  most one anchor per side unless directions genuinely differ.
- **Every edge pins its route.** Connection points are fixed in the edge's style
  (`exitX`/`exitY`/`entryX`/`entryY`) and every jog is an explicit waypoint, never left
  for the router to invent. A pinned route is a literal polyline in the XML, so all the
  rules above are checked mechanically rather than by eye (lint, warning on a floating
  connection). Fractional attachment points rarely land on integer coordinates: use the
  `exitDx`/`exitDy` and `entryDx`/`entryDy` pixel offsets to pin a run to an exact x or
  y. When editing by hand in the draw.io UI, add corners with right-click and "Add
  Waypoint" (dragging a segment alone does not create one), and re-verify after moving
  any shape: pinned endpoints follow the shape while waypoints stay put, and the router
  bridges the gap with exactly the diagonals and stutters these rules forbid.
- **Z-order.** A filled shape paints over any cell declared before it, so an icon
  embedded in a box must be declared AFTER the box or it renders invisible (eyeball).

## Working size

A diagram's content aims to stay inside roughly 1300 x 800 model units, the size at
which default-font text is still legible at README column width. The budget is
ADVISORY: a nudge toward compactness, never a rule that outranks any other on this
page (lint, note naming the size). A hard limit sits further out: the exporter clamps
a PNG's long side to 16384 pixels without a word, so `render` refuses a model whose
export would pass that at the configured scale and names the scale that fits, and
`check-pair` reads a sibling sitting on the limit as clamped. What stays binding is the ban on squeezing: smaller fonts and higher resolution
both fail, since the displayed width is fixed and only the model size decides
legibility.

The golden precedence: the binding rules on this page outrank the budget. When labels,
padding or routing cannot satisfy their rules in the space available, the diagram GROWS
until they can. Shrinking anything below rule compliance is never the fix: follow the
rules no matter what, make things bigger until they hold, and the diagram comes out
with enough space and clarity on its own.

An overrun the binding rules force is accepted as it stands (a full-anatomy diagram
that must show every member of a large contract). An overrun nothing forces is slack,
and slack has three exits: tighten the layout, split the content into more diagrams, or
move sequencing to a text sequence diagram in the README.

## Trimming reclaims the space it frees

Deleting members shrinks the containers, deleting actors shrinks the lanes that held
them, and every lane beside or below a shrunk container or lane moves in to restore the
normal inter-lane gaps, re-placing the step circles, edge labels and edge runs that
lived in the affected band. Tightening one box while the page keeps its old extents is
half the job: the freed area must leave the diagram, pulling it back toward the
working-size budget. The eyeball test: a reader who has never seen the untrimmed
diagram must not be able to point at where the deleted cells used to be. A band of
empty space whose only explanation is "something was deleted here" is a defect,
exactly as a broken label is (eyeball).

## Iconography

Icons are a semantic layer: one concept, one icon, wherever that concept appears. The
mapping belongs to the concept and not to any one cell type, so the icon that marks a
member kind in a diagram is the icon that marks that topic in prose. The project style
guide's icon table is the whole mapping, and nothing else restates which icon a shape
carries. Colour marks rank: top-level actors carry the coloured icons, and supporting
actors and members carry the black-and-white ones, so an icon's colour alone says
whether its bearer leads the diagram or supports it.

The table is the extension point. A new icon lands as one row there plus one entry in
the palette card's iconography section, and both land in the same change.

Icons come from the bank, never from ad hoc downloads: the project's `diagram-assets/`
folder holds the custom icons, pre-sized for embedding, and the generic ones are
draw.io built-in library references (`img/lib/...`). Custom icons are embedded into
each diagram as base64 copies of the bank files, which keeps every diagram
self-contained and portable (lint, error on a remote `image=` URL). Copy the icon
cells from the palette card's iconography section rather than re-encoding the files.
An iconography entry is a captioned card exhibit: when copying it into a diagram, take
the cell's style byte-identically and leave the destination cell's value empty, so the
caption stays on the card (the label-position tokens the style carries are inert on a
cell with no value). When an icon changes, update the bank file, the palette card, and
every diagram embedding it in the same change.

## The palette card

Every project has one copy-source card, `docs/diagram-palette.drawio`, started from
this repository's base palette and extended with the project's colours, icons and
shapes. Styled cells are copied from it, never restyled by hand: a cell whose style
family (its style with placement and routing tokens stripped) appears nowhere on the
card was hand-styled (lint, warning, when the config names the palette). A new style
lands on the card first, in the same change as its first use.

## Flow diagrams

The rules in this section hold for actor-and-step flow diagrams: lanes per system,
numbered steps in phase colours, an actor map plus one diagram per flow.

- **Colours mean phases.** Step numbers are ordinals per diagram, 1..N in that flow's
  execution order, so a phase keeps its colour in every diagram whatever number it
  carries there. The project style guide holds the phase table.
- **The actor map is the ONLY diagram showing the full anatomy** (every operation,
  every witness, every state field) and the full cast of actors. Pure helpers stay off
  the diagrams by default: a specific document may reintroduce one deliberately, case
  by case. A flow diagram's box carries ONLY the members that flow interacts with, so a
  new member dirties one diagram, not one per flow. The same bar holds for actors, in
  EVERY lane: a flow diagram draws ONLY the actors that flow interacts with. An actor
  the flow never touches, a cluster member with no edge in the flow, and a derivation
  note whose only consumer is a deleted actor all go, and the full cast appears on the
  actor map alone. Actor-level behaviour notes and their edges live on the actor map
  alone: a flow diagram's step layer tells the same story per flow with its labelled
  step edges. Membership, for members and actors alike, is read from the source code
  and the flow's executable files, never from prose.
- **A flow diagram starts as a copy of the actor map** with its `<diagram>` tag
  renamed, the non-interacted members and actors deleted, and the flow's step layer
  appended. Every kept cell keeps its id, value and style byte-identical to the actor
  map's cell of the same id: copy, never re-author. Only geometry may adapt, as the box
  tightens around the surviving members and the lanes close over the deleted actors.
  The check is cell-level, never a whole-file diff: strip the step layer, then each
  remaining cell's id, value and style must match the actor map's (diff-cells).
- **Hexagons mark events**, the kind word `Event` over the bold event name.
- **Step circles** sit per the layered-composition rule, and every step arrow carries
  its label per the golden rules. A flow diagram carries NO free-standing step text:
  its numbered circles are exactly the ordinals of the step list in the page beside
  it, a branch's arms sharing one ordinal with one circle per arm.

## Curated layouts (NEVER BREAK)

A diagram carrying the curation marker (an inert model cell with id `curated`, added
with `drawio-cli curate`) has a hand-tidied layout, and that layout is authorial. On a
curated diagram, an edit changes ONLY the cells its task names: the geometry, routing,
label seats and spacing of everything else are the curator's decisions, and this
page's layout preferences (working size, corner causes, circle seats and their kin)
defer to them. Lint findings that predate an edit are standing curatorial choices: they
are reported, never fixed unbidden. The semantic rules bind as ever: names come from
code, membership comes from the census, and the truth priority is unchanged.

The mandate is proven, never trusted: an edit to a curated diagram keeps a copy of the
file from before the edit and finishes with `guard-diff` over the before and after
copies, allowing exactly the cells the task authorised, and a violation is reverted
rather than allowed after the fact (guard-diff, error). Only the curator adds or
removes the marker, and a marking change re-renders the pair so the PNG's embedded
model carries the same state.

## Editing workflow

1. Edit the `.drawio` source, copying styles and icons from the palette card. Compose
   layer 1, lint, add layer 2, lint, add layer 3, lint.
2. Render the PNG from the source, with the settings in the config file.
3. Look at the rendered PNG before committing. Broken edge labels, escaped containment,
   missing icons and dead bands of empty space are all visible at a glance and
   invisible in the XML. Ask of every render: does any region read as "something used
   to be here"? Downscale the PNG and read it as an image too.
4. Measure what the guide says to measure: icon gaps, box hugs, label seats. `crop`
   cuts a region in model units out of the render for a close look, `fit-box` sizes a
   box to its ink, and `seat-label` seats a label on its run.
5. Commit the `.drawio` and `.drawio.png` together, and run `check-pair` on the pair
   before pushing.

**TIP:** If you are using a coding agent you can ask it to edit and render diagrams
for you: it can extract, edit, render, lint, measure and visually verify the result on
your behalf.
