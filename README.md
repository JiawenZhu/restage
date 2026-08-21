# Restage

> **`Restage` is a placeholder name.** It appears in the design files and in this
> README; renaming is a find-and-replace when the real name is settled.

An agent that edits an image toward a **stated outcome**, not on command.

You upload one photograph and say what you need it to do — *"this product shot
gets 0.8% CTR, make it look like a creator filmed it on their phone."* The agent
decomposes that into an ordered plan of 5–7 edits, explains why each one is
there, and executes them autonomously while you watch. After every edit a vision
critic judges whether the step achieved its stated intent; when it did not, the
agent revises and retries on its own.

Every edit preserves the image it came from, so history is a **branching tree,
not a linear undo stack**. You can interrupt at any node, reject a step, or
branch a different direction. Rejections are not discarded — they train a
persistent taste model that changes how the agent opens the next session.

## Use cases, in priority order

1. **UGC and product imagery** — making studio work read as creator-filmed
2. **Short-term rental / room staging** — *"lists at $120 a night, make it read $300"*

The same interface serves both. Only the source photo differs.

## The thing the product has to make visible

That the **machine is deciding** — not the human clicking. Three carriers, and
the interface fails if any of them is subtle:

1. The **plan** appears before any work starts, with reasoning per step
2. A visible **agent cursor** moves through the tree as it works, unattended
3. The **critic self-corrects** — a step judged insufficient, revised, retried

Failed and rejected attempts stay on the canvas. They are the evidence of
autonomy; hiding them removes the proof.

## Design

The canvas is published as an Artifact. Source lives in `design/`.

| Page | Artboards |
|---|---|
| **Landing** | Marketing page — light ground, one blue accent, UGC-led |
| **Product** | Executing (hero) · Node inspected · Planning · Returning session · Empty/upload · Component sheet |

Dashboard frames are 1920×1080 — the design is meant to be legible at 1080p,
seen once, by someone who has never used it, because it gets filmed.

Two deliberate splits:

- **The landing page is light; the product is dark.** The marketing reference
  (arcads.ai) is a light site and the product spec is dark-first. Both accents
  are the same blue, so the transition does not break.
- **Node images are drawn placeholders, not photographs.** The tree only works
  as a visual device because the nodes are the images themselves — so the
  artboards use illustrated scenes that change as the tree progresses. They are
  placeholders and should be replaced with real source material.

Every number and logo on the landing page is a marked placeholder
(`[YOUR MEASURED RESULT]`, `[CUSTOMER LOGOS]`). Nothing is invented.

## Status

Design only. No application code yet.

Some functionality is expected to be ported from an existing codebase
(CareerVivid) — Firebase wiring, auth, the credit/usage model, and the
agent turn-runner pattern. **None of its UI.** That port has not started.

## Layout

```
design/            .dc.html artboards, canvas.json, and the published canvas
```
