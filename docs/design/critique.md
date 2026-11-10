## Critiquing a screen (taste first)

This section is self-contained. It is distilled from the Wealthsimple `design-critique` skill (SKILL.md, its review rubric and its HTML builder) so a critique of a Job Tracker screen can be run from the repo alone (this file, `DESIGN.md`, `docs/design/copy.md`, `tools/design/critique/`). The "Wealthsimple" entries (W1-W5) came from Wealthsimple product reviews. Treat them as a taste reference, and add Job Tracker entries of your own through the capture step below.

### 1. What a critique is for

**Taste is the point.** A critique says what reads wrong on a screen and why. Design-system conformance, content, flow logic and accessibility are secondary notes (FYIs). Someone who wants a lint pass has other tools.

**Every entry is a tendency, not a violation.** A tell that fires is a reason to look harder, not proof of a mistake. Write "this reads as two competing accents", never "this breaks the single-accent rule". Assume the designer had a reason for every choice and report how it lands. A critique that sounds like a linter gets dismissed as one.

**Evaluate optimistically.** Where a detail can be read two ways, take the charitable one and critique what is in front of you. A finding built on the generous reading survives contact with the truth. One built on a suspicious reading sounds like you did not understand the work.

**Isolation: every review starts fresh.** Never read a previous review. That means no earlier `critique.md`, no `findings.json`, no old frames, and no listing of the folder that holds past reviews (for example `~/Desktop/Reviews/`). A design is judged against the rubric and nothing else.

- The rubric (section 4 below) is the only channel through which one review influences another. It is deliberate and curated: a tendency worth keeping is proposed, confirmed by the owner, and written into the rubric. Reading last month's critique is the failure, because nothing in it was confirmed as general.
- This holds within a session too. If you reviewed another screen an hour ago, its findings do not carry. Start from the frame in front of you.
- Red flags, stop if you catch yourself: opening any file under a review folder you did not create this run; listing the reviews folder; writing "as we noted previously"; carrying a finding across screens without passing it through the rubric.

| Rationalization | Reality |
| --- | --- |
| "Checking consistency with past feedback" | Consistency lives in the rubric. Past critiques are not precedent. |
| "Same designer, so context carries over" | The frame carries the context. Read the frame. |
| "Just checking we didn't already say this" | Repeating a finding costs nothing. Anchoring on a stale one costs the review. |
| "It's the same product area" | Then the tendency belongs in the rubric. Put it through the capture step. |
| "I'll glance at it, not rely on it" | You can't unsee it. Don't open it. |

### 2. Workflow

#### 2.1 Infer intent, never open with questions

A wall of questions before any critique makes the owner do your work and delays the thing they asked for. Read the frame, infer what it is, and critique on that basis. Infer:

- **What the surface is.** A list page, a settings page, an empty state, a confirmation step.
- **What it is trying to do.** Convince, inform, confirm, collect.
- **Screen or flow.** One page is a screen. Several frames, or a page plus the pages it leads to, is a flow.
- **Final or placeholder.** Assume anything that looks designed is final and critique it. Only obvious scaffolding (lorem ipsum, `$X,XXX.XX`, "Account name") is exempt.

State the inference in one or two lines at the top of the critique, and as `assumptions` in `findings.json`, so it is visible and falsifiable:

> Read as a pre-application product page for the 2% card, doing the convince job. Treating it as one screen, everything final.

If the owner already gave intent, use it and say nothing more about it. The only thing worth stopping for is when you genuinely cannot tell what you are looking at. Everything else becomes a follow-up (2.8).

#### 2.2 Get the frames onto disk

Every review gets its own folder named `YYYY-MM-DD-<slug>`, under `~/Desktop/Reviews/` unless the owner names another place.

```bash
BASE="$HOME/Desktop/Reviews/$(date +%F)-settings-and-needs-review"
mkdir -p "$HOME/Desktop/Reviews"
DIR="$BASE"
mkdir "$DIR" 2>/dev/null || DIR="$BASE-$(date +%H%M)"   # bare mkdir fails if it exists
mkdir -p "$DIR/frames"
echo "$DIR"
```

Everything lives there: `frames/`, `findings.json`, `critique.md`, and `review.html` if built. Do not list `~/Desktop/Reviews/` to pick the name. The date plus slug is enough, and the time suffix settles a same-day collision. Sibling folders are past reviews, so see the isolation rule.

Frames come from screenshots of the running app (section 6) or from images the owner drops in. Copy dropped images into `frames/` in order, and ask for the step order only if a flow's filenames do not imply it. Record each frame's pixel width and height for `findings.json`.

Depth is bounded by the review, not the frame count. A single screen is a couple of minutes. A large set should not cost the same per frame. Survey the whole set first, then look hard at only the few frames that carry findings.

#### 2.3 Read the rubric

Read section 4 in full before looking hard at any frame: both layers, the weighting, and the "what NOT to flag" list, which matters as much as the tells.

#### 2.4 Look, in six passes

1. **Whole-surface read, per frame.** Before hunting details: where does the eye land, is there one dominant accent, and, walking every tappable thing, can you tell what each one leads to? A page wants review as a whole. An element that is correct in isolation can still be wrong because of what surrounds it.
2. **Run the counts.** Three checks that only fire if you perform them, because reading a screen as a series of blocks hides all three:
   - distinct **type styles** (each unique size x weight x colour): C4
   - distinct **affordance languages** for the same class of navigation: C6
   - **images** on the surface, and distinct **rendering styles** among them: W3

   Say the number in the finding. A count is the one kind of evidence worth stating outright, because the reader cannot get it by looking. Across a large set, count over the set, not per frame.
3. **Per-frame craft tells (C1-C11).** 3 to 7 findings for the whole review, ranked by how much they matter. Hard cap 10. This is not per frame: a 34-frame board gets the same budget as one screen, so the findings that survive are the ones true across the set. Then check the Wealthsimple entries (W). One may override the call you just made, or add a tell craft alone will not catch.
4. **Flow pass (flows only).** The flow-level tells in section 4: chrome inconsistency, hierarchy that shifts, motif pileup, scale and spacing drift, progress honesty, voice drift, step redundancy, migrating elements. These belong to the flow, not to a frame.
5. **Pattern questions (P) and secondary FYIs (F), compact.** P items are questions about app-wide treatments you cannot answer from one surface: name the pattern, describe the treatment, ask. Do no research to raise one, and never assert what the app's standard is.
6. **Cross-check content findings only.** If, and only if, you have content findings, check them against the project's own copy rules (section 6 lists where they live for this app) and use that to veto or amend. Never to generate new findings. If you cannot check, add one line to `followups` and never imply you did:

   > Content findings were not cross-checked against the copy guidelines. Point me at them and I can verify these.

#### 2.5 Write `findings.json`

```jsonc
{
  "title": "Cash home - privacy mode",
  "kind": "flow",                       // "screen" | "flow"
  "intent": "One or two sentences, in the designer's own framing if they gave one.",
  "assumptions": ["What you inferred, so it's falsifiable."],
  "followups": ["Questions whose answers would change a finding. May be empty."],
  "frames": [
    { "id": "f1", "label": "1 - Overview", "image": "frames/01.png",
      "width": 390, "height": 844 }
  ],
  "findings": [
    {
      "layer": "craft",                 // craft | ws | pattern | ds | content | flow | a11y
      "frame": "f1",                    // omit for a flow-level finding
      "title": "Hero value and balance row compete",
      "region": "the balance row directly under the hero number",
      "box": { "x": 4, "y": 22, "w": 92, "h": 9 },   // % of frame, optional
      "reads": "Why it reads wrong on THIS screen.",
      "fix": "The concrete change.",
      "if": "the cash-back strip is final copy",     // optional; marks a finding that
                                                     // only holds under an unconfirmed assumption
      "cite": "C1"                      // rubric id (C/W/F), optional
    }
  ]
}
```

- `region` is required and `box` is not. The box is a convenience; the words are the finding. Describe the region so precisely that a misplaced marker is still unambiguous. You are estimating coordinates from a render and will sometimes be off. Omit `box` rather than guessing wildly.
- Order `findings` by importance. Craft and Wealthsimple findings first, FYIs after. Numbering follows array order, so the numbers match `critique.md`.
- A `pattern` finding renders its `fix` as "Ask" instead of "Fix", so put the question there.
- Findings with no `frame`, or with a frame id that is not in `frames`, show under "Across the flow" in the HTML.

#### 2.6 Write `critique.md` and deliver it

This is the deliverable. Write it and hand it over before building anything else. The markdown is fast, it is what gets pasted into Slack or a ticket, and the owner should not wait on a rendering step to read their own critique.

Structure: the inferred read in two lines, a one-line headline problem, the primary findings ranked, then secondary FYIs under their own headings with owners named. It must stand alone. Section 7 is a template.

Then deliver it in chat: the headline problem and the findings themselves, not a summary of them and not a description of the file you wrote. The owner wants the critique, not a status report on it. Print file paths bare on their own line, because wrapped in prose they get elided in the terminal and become unclickable. `open "$DIR/critique.md"` opens it.

#### 2.7 Offer the HTML mark-up, do not build it unasked

Building `review.html` inlines every frame as base64, so it is the slow part of the job and most reviews do not need it. Offer it in one line: "Want the marked-up HTML version, with the findings pinned to the frame?" On yes:

```bash
node tools/design/critique/build-review.mjs --findings "$DIR/findings.json"   # add --link for big frames
open "$DIR/review.html"
```

You get frames with numbered callouts and the findings alongside. Clicking a callout jumps to its finding and back. The file is self-contained, so it can be shared as one file. Open it for the owner, and do not load it into a browser tool to check your own work.

#### 2.8 Follow up after the critique, never before

Ask what you held back, but only if an answer would change a finding. Anything else is curiosity and costs the owner time. Put them in `followups` (they render under "Worth confirming") and repeat at most two or three in chat. Good ones are specific and tied to a numbered finding:

> **3** assumes the "5% cash back the first month" strip is final copy. If it is a placeholder, ignore it.

Findings that depend on an unconfirmed assumption carry `"if"`, so they stay honest without being withheld: state the finding, mark the condition, move on. Skip this step entirely when nothing would change. An empty follow-up list is a good outcome.

#### 2.9 Capture what the review taught the rubric

After the owner responds, look at what they corrected, confirmed or added. Anything that reads as a durable tendency, not a one-off, belongs in the rubric's app-specific layer (the W entries; for this app, add entries as W6, W7 and so on, or start a "Job Tracker" layer beside them). Propose candidate entries and wait for confirmation before writing, because that layer is the owner's taste, not yours. An entry earns its place when it meets all three:

1. **Seen twice, or stated as a principle.** One instance is a bug in one design. Two, or an explicit "we don't do that here", is a tendency.
2. **Not already covered by a craft section.** If C3 already catches it, the craft layer is doing its job. Do not duplicate.
3. **Has a reason, not just a value.** "Gutter is 16" is a spec. "The gutter staying constant across breakpoints is what makes the app feel like one surface" is a tell you can review against.

Entry format: **Tell**, **Reads as**, **Usual fix**, plus **Overrides** when it contradicts its craft section, and **Source** (which review it came from) always. Give it the next free number, say which craft section it extends, keep it under about 120 words, and edit this section of `docs/design/critique.md`. The craft layer is stable: revise it only when a principle turns out to be wrong, not to add specifics. Do not bulk-import design-system or prototyping docs into the rubric. Those describe how to build, and a rubric needs tells you can see in a render and reasons they read wrong.

### 3. The shape of a finding

Three parts, in this order, and nothing else:

1. **Title.** One line naming the problem. Not the fix, not the evidence.
2. **Reads.** One or two sentences: what is wrong and why it lands that way.
3. **Fix.** One sentence: the concrete change.

Under 60 words all in. If you need more, you have two findings or one you do not understand yet. Drop any finding with no why, because the why is what makes it a critique rather than a rule restated. Drop any finding whose fix is "nothing". That is context, and it goes in `assumptions`.

**Say the observation, not the case for it.** The reader is looking at the same frame you are and does not need convincing the thing is there. One number if it is load-bearing, none otherwise. No recitation of measurements, no walk-through of every instance, no restating the fix in the reads.

Worked compression, 110 words down to 35:

> **Before.** "Wealthsimple credit card" is the largest element in the hero and it tells the reader nothing they didn't get from the nav bar... The one line worth saying, earn 2% on everything, is set as a small pill, the quietest structural role on the surface, and then repeated a third time down in the features list... **Fix:** Swap the two. Make the proposition the headline ("2% cash back on everything") and let the product name sit above it as a small eyebrow, or drop it since the nav carries it. The metallic pill treatment then has nothing to prove...
>
> **After.** The hero's largest type is the product's name, which the nav already carries; the actual proposition, 2% on everything, is a small pill. **Fix:** Swap them: proposition as the headline, product name as an eyebrow or dropped.

Everything cut was evidence for a claim the reader can verify by looking.

**Prefer removing the cause to improving the symptom.** Before proposing a fix that improves something, ask C11 (can this be simpler?). A well-labelled control that should not be there is still worse than its absence.

**Write tendencies, not violations.** See section 1.

### 4. The rubric

Two layers. **Craft (C)** is universal design craft. It always applies, it is complete as written, and it makes a critique useful on a surface nobody has recorded guidance for. **Wealthsimple (W)** holds overrides and additions keyed to the craft section they modify. Where a W entry speaks, it wins over the C principle it extends. Critique against C, then check whether any W entry changes the call.

#### 4.1 Weighting

| Layer | Weight | Findings to aim for |
| --- | --- | --- |
| Craft (C1-C11) | primary | 3-7, ranked. Hard cap 10. |
| Wealthsimple (W) | primary, overriding | as many as genuinely fire |
| Pattern questions (P) | question, not a defect | 0-3, no research |
| DS conformance (F1) | secondary FYI | 0-4, evidenced only |
| Content and tone (F2) | secondary FYI | 0-3 |
| Flow and interaction logic (F3) | secondary FYI | 0-4 (flows only) |
| Accessibility (F4) | secondary FYI | 0-3 |

Under-reporting beats over-reporting. Seven sharp findings land; twenty get skimmed. If a tell fires but you cannot say why it reads wrong on this screen, drop it.

#### 4.2 Layer 1: Craft

**C1 - Focal hierarchy**
- Tell: two or more elements competing for heaviest visual weight (same size and weight, two saturated fills, a hero and a card below both shouting). Or the opposite: nothing carrying weight, so the eye has nowhere to start.
- Reads as: the eye does not know where to land, and the intended hero loses its job.
- Usual fix: pick the one focal element. Step everything else down a level: quieter fill, lighter weight, smaller size, softer foreground.

**C2 - Restraint**
- Tell: decoration that carries no information. Gradients stacked on gradients, a flourish wrapped around a number, a border and a shadow and a fill all separating the same thing. Effects doing a job something simpler already did.
- Reads as: overproduced; a marketing comp rather than a product surface.
- Usual fix: find the one treatment doing the most work and flatten the rest. Ask of each element what breaks if it is removed. If nothing, remove.

**C3 - Grouping, alignment and rhythm**
- Tell: spacing that does not encode structure. Related things as far apart as unrelated things, so groups do not read as groups. Edges that almost line up. Gaps drawn from an arbitrary set of values rather than a consistent interval.
- Reads as: a misalignment rather than a deliberate nesting; the layout feels assembled rather than composed.
- Usual fix: make within-group gaps clearly tighter than between-group gaps. Align to a shared edge. Pick spacing from a consistent scale.
- Judgment: flag space that reads wrong, not space that measures wrong. You are looking at a render.

**C4 - Type hierarchy**
- Tell: too many distinct sizes and weights, so no level reads as a level. Or two levels close enough that the difference reads as an accident. Ad-hoc sizes outside the type scale. Headings competing with the content they head.
- Reads as: flat and hard to scan, or noisy and arbitrary.
- Usual fix: fewer levels, each clearly distinct. Take sizes from the scale so paired tracking and line-height come with them.
- Count them. Literally enumerate the distinct type styles on the surface, each unique size x weight x colour. More than about five on one screen is a tell on its own, and it is the single easiest thing to miss by reading the screen as a series of blocks rather than as one type system. Say the count in the finding.
- Also watch measure (very long or very short line lengths), orphaned single words on a heading's last line, and body copy competing with headings instead of sitting back.

**C5 - Colour and contrast**
- Tell: colour used decoratively where it reads as semantic, or semantic colour used at a strength that overpowers. Contrast not doing hierarchy work: everything at full strength, or the hierarchy carried by size alone.
- Reads as: meaning the designer did not intend, or a flat surface where emphasis should exist.
- Usual fix: let contrast carry hierarchy, with primary, secondary and tertiary foregrounds rather than one weight for everything. Reserve saturated colour for the places it means something.
- Hue versus value. Distinct hues encode categories; value and weight encode hierarchy. Reaching for a second hue to separate two groups that a heading already separates spends the strongest channel on information the reader had, and leaves nothing to rank with. Ask whether a value step (a grey chevron against a black one) does the job the second hue was doing.

**C6 - Affordance honesty.** Two directions. Both matter; the second is the one that gets missed.
- False affordance. Tell: a hover or pressed state on something that is not interactive. A chevron pointing at a view that does not exist. `cursor: pointer` on a static card. Reads as: a lie, a visible response to an action that does nothing. Usual fix: remove the affordance, or make the thing actually do it.
- Missing or ambiguous affordance. Tell: go through the surface and ask of every element whether you can tell it is tappable. Look for containers that look identical whether or not they navigate, rows where only a small arrow carries the affordance, and text that acts as a link without reading as one. Two specific shapes: a **small action nested inside a large object** (a "Manage" label inside a big card), where it is unreadable whether the object or just the label is the target; and **content blocks with no affordance at all** that plainly lead somewhere (a promo tile, a rate summary), leaving the reader to guess. Reads as: the reader either misses the action or taps something inert. Usual fix: make interactive and static treatments visibly different, and make the whole sensible region the target rather than a small glyph inside it.
- Count the affordance languages. Enumerate how many visually distinct ways the surface signals "this navigates": chevron at a row's end, chevron trailing a value, chevron inside a pill, icon-and-label with no chevron. More than one or two for the same class of navigation means the reader is learning several languages on one screen. This overlaps C7 and C10; report it once, wherever it bites hardest.
- Containment matters: a standalone target can respond with a whole-element transform; an element with visible siblings sharing its edges should respond with a fill change instead, or the row pulls out of alignment and the list looks like it is flexing.

**C7 - Consistency within the set**
- Tell: the same kind of thing treated two ways on one surface: two card styles for the same role, two row heights in one list, two icon weights, two corner radii.
- Reads as: ragged; the surface looks unfinished rather than varied.
- Usual fix: pick one and apply it. If two treatments are genuinely needed, make the difference large enough to read as intentional.
- Scope: this is consistency within the surface you are looking at. Whether the surface matches the rest of the app is a pattern question (P), and it is a question, not a finding.

**C8 - Platform commitment**
- Tell: a treatment that approaches a native platform convention without fully committing to it.
- Reads as: "off" in a way that is hard to name. Half-following imports the platform's mental model (tap targets, feedback, gesture expectations) and then breaks it.
- Usual fix: commit fully to the platform convention, or fully to a custom treatment. The gray zone is the problem.

**C9 - Motion (only if the input shows motion)**
- Tell: motion you notice instead of the result it produced. A hard snap. An overlap that reads as a double image. A crossfade between two things that are also moving.
- Reads as: the eye tracks the motion rather than the change.
- Usual fix: soften the timing or fix the direction; rarely add more motion. Positional siblings want directional entry matching their layout position. Exit wants shorter and ease-in; enter wants slightly longer and ease-out. An indicator should travel, not vanish and reappear.

**C10 - Navigation scent.** Distinct from C6: that asks whether the reader can tell something is tappable. This asks whether they can tell what they will get, enough to decide the tap is worth it.
- Tell: a label naming the container rather than the destination or payload: "2 alerts", "Off", "Manage", "Details", "View". A chevron on a value with no hint where it leads. A state label whose meaning depends on knowing the feature already. A truncated horizontal row where the peek is a **clipped label** rather than a visibly clipped tile, so it reads as a rendering bug instead of "there is more this way".
- Reads as: the reader cannot predict what is behind the tap, so they either do not take it, or take it and immediately back out. Both are worse than a longer label.
- Usual fix: name what is behind it (what the alerts are, what "Off" is off). Where the label genuinely cannot carry it, let the surface preview the payload instead of pointing at it. Make a peek read as a peek.

**C11 - Can this be simpler?** The highest-value question in a review, and the easiest to skip. Whatever is on the screen reads as a given, so the natural move is to improve it rather than ask whether it belongs. Distinct from C2, which is about decoration that carries no information. This is about structure and interaction: how much there is to operate, read and understand.

Ask it of the whole surface first: what is the simplest version of this that still does the job? Then name the gap between that and what is there. Moves, roughly in order of how much they buy:
- **Cut a concept.** Does the reader need this distinction at all? A split into personal and business, a tier, a category. If the task does not turn on it, it is overhead the reader carries for free.
- **Remove the mechanism.** A checkbox gating an explicit Confirm button: the button already is the consent, and the checkbox says it twice. A better-labelled checkbox is a worse outcome than no checkbox.
- **Merge two things into one.** Two expand controls where one above the set would do. Two steps where the second restates the first.
- **Let a default do the work.** Disclosure hiding two rows, or a collapse that is expanded by default anyway. Ask what the collapse buys at the row count this screen actually has.
- **Drop a channel.** Colour-coding categories that a heading already separates. The hue is spent on information the reader had, and is then unavailable for hierarchy (see C5).
- **Reduce the count.** Fields, options, treatments, levels of nesting.

The surface as a whole: if a screen feels complex, that is the finding. Count the distinct things it asks the reader to operate (expanders, checkboxes, toggles, pills, nested selections) and ask which the task needs. "This screen is carrying more than the task needs" is legitimate on its own, and often the most useful thing in the review.
- Reads as: work the reader has to do that the design could have absorbed.
- Usual fix: propose the removal, not a polish of the thing you would remove.

#### 4.3 Layer 2: Wealthsimple overrides and additions

Each entry says which craft section it extends. Where it speaks, it wins.

**W1 - One focal point, one primary CTA (extends C1)**
- Tell: more than one thing on the surface carrying top-level weight, or the primary button treatment used more than once. Watch for a side-road action (`View all benefits`, `Learn more`) wearing the same treatment as the action the page exists to drive, especially when the reader meets the side road first.
- Reads as: a detour competing with the goal; the primary treatment stops meaning "primary".
- Usual fix: the primary treatment appears exactly once per surface. Step secondary actions down to an outline or a text link.
- Sibling actions: in a set of peers (a quick-action row, a tile grid), some wearing the primary treatment and others not implies a category difference the set does not actually have. Either the row is one set and reads as one, or the split means something and the labels say what.
- Long marketing surfaces: a product sheet or pre-application page has many sections and cannot have literally one focal element. The principle still holds one level down: one focal point per section, and still exactly one primary action for the whole page.
- Source: credit-card pre-application page review, 2026-08-26.

**W2 - Don't reach for a card (extends C2)**
- Tell: content wrapped in a card where it could sit directly on the background, and cards applied unevenly across a surface so the choice of what is and is not carded reads arbitrary.
- Reads as: containers doing no work; the surface looks partitioned rather than composed, and, because a card is also an interactivity signal (C6), it muddies what is tappable.
- Usual fix: default to no card. Add one only when it is grouping something that needs grouping, or when the whole tile is the tap target. Mixing carded and background-direct content is fine when the split means something.
- Overrides: C2 treats containers as one kind of decoration among many; here it is a specific, common default worth checking on every surface.
- Source: credit-card pre-application page review, 2026-08-26.

**W3 - Assets earn their place, in one rendering style (extends C2, C7)**
- Tell: count the images on the surface and count the distinct rendering styles among them (lighting, crop, how literal each one is). Several good assets in different styles is the common case. Then ask of each: is it doing informational work, or is it decoration? Decoration inside a block whose job is to explain something, and an image restating a line the copy has already made, are the two that earn least.
- Reads as: a moodboard of separate marketing pieces rather than one product surface.
- Usual fix: keep the assets doing informational work, cut the rest. If more imagery is needed, commission it in one rendering style rather than reusing whatever exists.
- Source: credit-card pre-application page review, 2026-08-26.

**W4 - Surface colour is semantic, not positional (extends C6, C7)**
- Corrects an earlier version of this entry that said "a nested surface is lighter than its parent, never darker." That was wrong, and it produced a finding telling a designer to invert a screen that was already right. Direction of elevation is not the test.
- The convention: white or light surfaces signal interactivity. Darker grey surfaces group content. A darker card on a lighter page is correct when it is a container. White cards on a grey page are correct when each card is a target.
- Tell: a white card that does nothing on tap, or a grey grouping card that is itself the target. Those are the failures, not the light/dark direction.
- Reads as: the surface treatment stops predicting behaviour, so the reader cannot use colour to tell what is tappable.
- Usual fix: match the fill to the role. Never "pick one direction and apply it everywhere", because that flattens the signal this convention exists to carry.
- Overrides: C7 would read the two treatments as an inconsistency. They are not; they are two different meanings, and consistency is judged per role.
- Source: credit-card review (original, wrong) and PLOC flow review (correction).

**W5 - Body copy sits in the secondary foreground (extends C5)**
- Tell: body and supporting copy set in the primary foreground, so a screen reads as one flat wall of black text.
- Reads as: no texture; headings and values stop leading because everything is at full strength.
- Usual fix: body copy defaults to the secondary or subdued foreground. Promoting a line to primary is a deliberate exception for the one sentence that must be read. If you are proposing it, say why that line is the exception.
- Overrides: C5 says contrast should carry hierarchy but does not set a default. This does.
- Source: PLOC flow review.

#### 4.4 Pattern questions (P)

Some treatments are decided app-wide, not per screen, and you are looking at one surface, so you do not know what the app does elsewhere. C7 asks whether a surface is internally consistent. This asks something you genuinely cannot answer: is this treatment the one the app uses for this pattern?

So do not answer it. **Name the pattern, describe this surface's treatment neutrally, and ask.**

- **Never assert the correct treatment.** Not "this should use a chevron." The standard moves, the rubric cannot track it, and a confident wrong answer costs more than an open question: it sends someone to change a screen that was already right.
- **Do no research.** These are recognised, not investigated. You raise one because the pattern is a kind that commonly diverges, not because you went and found divergence. Do not survey the code or other screens to build a case. If a single grep for a named component would settle it, that is allowed: one grep, then stop. Never a sweep.

Patterns that commonly diverge (raise whichever the surface actually shows):
- Row progression affordance: chevron, arrow in a circle, whole-row tap, a radio plus a separate Next, or nothing at all.
- Selection mechanics: tap-to-advance versus select-then-confirm.
- Where the primary action lives: pinned to the bottom, inline, at the end of a list.
- Back, cancel and close: which exist, which corner, what each does.
- Empty, loading and error treatments for the same kind of content.
- Section header actions: a button, a text link, or a chevron on the header.
- Money and date formatting, and whether currency is shown.

Shape: one line naming the pattern and the treatment, one question. No fix.

> **Row progression.** These rows advance via an arrow in a white circle on the right. The same pattern appears elsewhere as a plain chevron, and as a radio with a separate Next button. Is the circled arrow the intended treatment for account-selection rows?

A P item is never a defect and is not counted as one. If the answer comes back "no, the standard is X", that is when it becomes a finding, and a candidate for the W layer via the capture step.

#### 4.5 Secondary FYIs (F)

Report compactly, below the primary findings. Every one must be evidenced. **Route by who fixes it.** The primary findings are the designer's to act on. A finding that is not theirs goes down here with the owner named ("this is the design-system owner's call", "this needs a compliance read"). Mixing somebody else's constraint into the designer's list wastes the most valuable slots in the critique.

**F1 - Potential design-file / design-system issues.** File-level and component-level observations. Frame them as worth confirming, possibly deliberate: you are looking at someone's working file, and a detached instance or an off-scale group is often a known trade-off. Never lead with certainty. Assert this section only with real evidence (design-tool variable or component data, or code you can grep). With neither, say the evidence is missing and skip it. Never infer a token, hex, duration or stroke width from a PNG. Screenshots pasted into a design canvas contain no components, variables or instances, so this section is unavailable for them; say so once and move on. For this app the equivalent evidence is the code in `web/src` and the CSS tokens it uses.
- Detached instances where a component exists (rows, cards, list items rebuilt as plain frames will not pick up component changes).
- A group that has been scaled rather than resized, dragging tracking and line height off-scale.
- Two token collections in play at once, or reserved/system tokens used directly.
- Raw values where a token exists.
- Icons off-system, off-size, or off-weight.
- Assets not sourced from the sanctioned paths.
- Chart geometry that fights the charting primitive.
- Design-system-owned constraints, like a shared component whose default tap target or type size is below spec. The designer using the component is not the one who fixes it. Say so.

**F2 - Content and tone**
- Casing and punctuation consistent with the rest of the product.
- Plain language over jargon; no unexplained acronyms on first use.
- Errors that say what happened and what to do next.
- Labels naming the outcome, not the mechanism.
- Numbers, dates and deltas formatted consistently across frames: one rule for thresholds, one for prices, and the same fact worded the same way each time it appears.
- Claims that need someone else's sign-off (comparative or performance claims, anything a regulator would read) go here with the owner named. Flag for a compliance read and move on; it is not a design finding.

Cross-check content findings against the source of truth. Rules that keep this cheap: only check findings you already have (no content findings means no checking); it is a veto, not a source of new findings (if a guideline contradicts your suggestion, drop or amend the finding and say where the answer came from); if the source is unreachable, carry on and note it once in `followups`. For Wealthsimple product copy the sources are Notion "AI Reference" pages, mapped by kind of finding: Voice and Tone (wording, voice, register, humour) https://app.notion.com/p/34041167bd9681fb9b73dd917d9f0273; Grammar and Formatting (casing, punctuation, numbers, dates) https://app.notion.com/p/34041167bd9681048949d2d691f291c6; Glossary (terms, product names) https://app.notion.com/p/34041167bd96814dbdd3fc654260d36e; UI components (button, label, tag, menu copy) https://app.notion.com/p/ea5a87c86d9b462db1105841afda4ab3; Legally approved product claims https://app.notion.com/p/ffdff1daf65f4f6faf5309ad5d4b5aae (a comparative claim may already be approved, in which case a compliance flag wastes time); Feature-specific guidelines https://app.notion.com/p/e1ba388288674f2a9efdd63db4262d1f; Braze in-app surfaces https://app.notion.com/p/37d41167bd968038ac97c81aab6a8dbe. Job Tracker is a personal app, so these mostly do not apply; use the app's own copy rules (section 6).

**F3 - Flow and interaction logic (flows only)**
- Entry and exit: how the user got here, how they leave, whether back and cancel both exist and do different things.
- Missing branches: empty, loading, error, partial, no-permission.
- Dead ends: no forward action and no way back.
- Steps that earn nothing: a confirmation confirming nothing, a screen with one field.
- Irreversible actions without confirmation; confirmations on trivial ones.
- State that silently resets on back.

**F4 - Accessibility**
- Text contrast against its actual background, not against white.
- Tap target size, especially on rows that can render short. If the undersized target is a shared component's default, that is an F1 item with a design-system owner, not a finding against this design.
- Meaning carried by colour alone.
- Focus order and visible focus on web; dynamic type on mobile.

#### 4.6 Flow-level tells (multi-frame only)

Check these after the per-frame pass.
- **Chrome inconsistency:** nav, back affordance or pinned action changing treatment or position between steps for no reason.
- **Hierarchy that shifts:** the focal element moving arbitrarily, so the user re-learns where to look each step.
- **Motif pileup:** the same strong treatment three steps running.
- **Scale and spacing drift:** title size or section gaps changing with no content reason.
- **Progress legibility:** whether the user can tell how far through they are, and whether that indicator is honest.
- **Voice drift:** one step written warmly, the next like a system message.
- **Step redundancy:** a step restating what the previous one already showed. Ask what this screen adds that the last one did not. If the answer is "nothing but a control", the two may be one screen.
- **Migrating elements:** a value that moves between steps and changes treatment on the way (a rate that is a table row on one screen and a pill beside the hero on the next). Ask whether it earns its place on each step, and why the treatment changed.

#### 4.7 What NOT to flag

Precision here is what keeps the critique credible.
- **Gaps off by a pixel or two.** Flag space that reads wrong, not space that measures wrong.
- **Values you cannot see.** Describe what it reads as; claim values only from the design file or code.
- **Obvious placeholder content.** Lorem ipsum, `$X,XXX.XX`, "Account name": scaffolding, not decisions. Anything that looks designed is treated as final and critiqued. When unsure, critique it and mark the finding contingent rather than skipping it.
- **Anything the stated intent already answered.** "Ignore the illustration, it's a placeholder" puts it out of scope. Where intent was inferred rather than stated, do not withhold: state the finding and mark it contingent.
- **Deliberate exploration.** An option in a set of three is not wrong for differing from the other two. That is the point of the set.
- **The same finding on every frame.** Say it once, at flow level.
- **Rules restated without a reason.** "Sections should be 40px apart" is not a finding. "The two sections read as one group because the gap matches the in-group gap" is.
- **Anything whose fix is "nothing to fix".** If there is no action, it is not a finding. It is context; put it in `assumptions` ("the intro is a placed PNG, so its width and figures aren't decisions") and do not number it. A numbered finding is a request to change something.
- **Canvas debris.** Orphan layers parked off-screen, leftovers from another design, a stray background rect. That is housekeeping in someone's working file, and reporting it spends a slot the designer cannot use.
- **Component anatomy, props and edge cases.** The design-system documentation is canonical for those; this rubric is about how the surface reads.

**On "nothing flagged".** A frame can legitimately be clean, but a dense frame with nothing flagged is almost always a looking failure rather than a quiet screen. Before you record it, re-read the whole surface and ask C11: what is the simplest version of this that still does the job? Complexity is itself a finding.

### 5. Common mistakes

Every row is a failure that actually happened in testing.

| Mistake | Instead |
| --- | --- |
| Opening with questions | Infer intent, critique, ask afterward, and only what changes a finding. |
| Polishing something instead of simplifying it | Ask C11 first: can this be simpler? |
| "Nothing flagged" on a visibly dense frame | Re-read the whole surface. Complexity is a finding. |
| A finding over 60 words | Cut the evidence. The reader has the frame. |
| A finding whose fix is "nothing to fix" | Not a finding. Move it to `assumptions`. |
| Someone else's constraint in the designer's list | Move it to an FYI and name the owner. |
| Asserting hex values, tokens or durations read off a PNG | Describe what it reads as. Claim values only from the design file or code. |
| Asserting what the app's standard treatment is | You saw one surface. Raise it as a P question, with no research. |
| Screenshotting 30 frames one by one | Survey the whole set, go deep on the few that matter. |
| Reading a past review for context | Isolation. The rubric is the only carry-forward. |
| Implying content was verified when the source was unreachable | Say it was not, in the follow-ups. |

### 6. Running it on this app

**Evidence for F1.** The hosted edition is `web/` (Vite, `base: "/job-tracker/"`). Tokens and components are in `web/src`, so F1 and F2 findings can be evidenced by grep there. Check `docs/design/copy.md` (voice, glossary, gates, button and error rules) and `PRODUCT.md` (what the app is) before making any content finding. Without those, skip F1/F2 and say so.

**Screenshots with headless Chrome.** No Puppeteer or Playwright is needed. Spawn Chrome with `--headless=new --remote-debugging-port=<port> --user-data-dir=<temp dir> --hide-scrollbars about:blank`, poll `http://127.0.0.1:<port>/json` until a page target appears, and open its `webSocketDebuggerUrl` with Node's built-in `WebSocket`. Then drive it with DevTools commands:

1. `Page.navigate` to the dev server (`cd web && npm run dev`; the URL looks like `http://localhost:5199/job-tracker/`) and wait about 2.5 seconds.
2. A fresh profile is empty, so click the "Load demo data" button via `Runtime.evaluate` (find the button whose text matches `/demo/i`) and wait about 3 seconds. Note this means Sync and Account cards are absent. Say so in `assumptions`.
3. For each shot: `Emulation.setDeviceMetricsOverride` to the width (1280 desktop, 390 phone with `mobile: true` below 600), `Emulation.setEmulatedMedia` with `prefers-color-scheme` light or dark, set `location.hash` to the route (`#/settings`, `#/review`), wait about 1.8 seconds, read `document.documentElement.scrollHeight`, resize the viewport to that height (cap 4000) so a single capture is the full page, then `Page.captureScreenshot` as PNG and write the base64 to `frames/<name>.png`.
4. Print each shot's name and size and copy width and height into `findings.json`. Printing `scrollWidth` against `innerWidth` flags horizontal overflow, which is itself a finding on a phone frame.

Working scripts are committed in `tools/design/critique/`: `shoot.mjs` takes `--out <dir>/frames`, `--base <url>`, `--shots "name:width:theme:hash,..."` (and `--chrome`, `--port`, `--no-demo`). `build-review.mjs` builds the HTML, and `README.md` there repeats the commands and says what was verified. Keep those files with the repo, since this section depends on them.

**Which frames.** One screen is one or two frames at desktop. Add a phone frame only if the surface has a distinct phone layout, and a dark frame only if colour is in question. The earlier Settings and Needs review critique captured phone and dark frames but judged only the two desktop ones, which kept the review focused. Do not spend findings on frames you captured only for reference.

**Judging from a render.** You can see counts (type styles, affordance languages, images) and how things read. You cannot see token names or exact values from a PNG, so claim those only from `web/src`.

### 7. Template for `critique.md`

```markdown
# <Screen or flow name> review

<One or two lines: what this was read as, what job it does, screen or flow,
everything treated as final, anything not in frame (e.g. demo mode). Judged from
which frames.>

**Headline:** <One sentence: the single biggest problem and the direction of the fix.>

## Findings

1. **<Title naming the problem, not the fix.>** <Reads: one or two sentences, one
   load-bearing number at most.> Fix: <one sentence, concrete.>
2. **<Title.>** <Reads.> Fix: <fix.>
3. ...  (3-7 total, ranked, under 60 words each)
6. **Pattern question:** <name the pattern and this surface's treatment neutrally.
   One question. No fix.>

## Secondary notes

- **Design system / code (owner: <name>):** <only if evidenced; say possibly
  deliberate.>
- **Content (owner: <name>):** <consistency, casing, a claim needing sign-off.>
- **Flow (flows only):** <missing branch, dead end, step that earns nothing.>
- **Accessibility:** <contrast, tap target, colour-only meaning.>

## Worth confirming

- Finding <n> assumes <assumption>. <What changes if it is wrong.>
- <Any check you could not run, e.g. content not cross-checked.>
```

Rules for filling it in: findings are ranked by importance with craft and W entries first; the doc must stand alone without the HTML; omit any heading that has nothing under it; an empty "Worth confirming" is fine; and the same findings, with `region` and optional `box`, go into `findings.json` in the same order.
