# Restage

> **`Restage` is a placeholder name.** It appears in the design files and in this
> README; renaming is a find-and-replace when the real name is settled.

An agent that makes UGC video ads **with your own face**.

You enrol once — left, straight on, right — and that avatar is reused forever.
Then you state what the ad has to do (*"a 15-second ad where I actually use the
serum, in my kitchen"*) and the agent decomposes it into an ordered plan of 5–7
steps, explains why each one is there, and executes them autonomously while you
watch. After every step a vision critic judges whether it achieved its stated
intent; when it did not, the agent revises and retries on its own.

**The plan runs on still frames, not video.** A frame costs ~14 seconds, a clip
~41 — measured, not estimated. So the agent is allowed to be wrong cheaply, and
only the frame you approve is ever rendered to video.

Every edit preserves the image it came from, so history is a **branching tree,
not a linear undo stack**. You can interrupt at any node, reject a step, or
branch a different direction. Rejections are not discarded — they train a
persistent taste model that changes how the agent opens the next session.

## Formats

9:16 and 16:9 are both first-class, chosen in the brief **before the plan is
written** — so every frame is composed for that ratio rather than cropped at the
end. A 16:9 ad is not a 9:16 ad with the sides removed: the subject sits
differently and so does the product. An approved frame can be re-rendered in the
other ratio without paying for the plan again.

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
| **Landing** | Marketing page — light ground, one blue accent, avatar-led |
| **Product** | Build your avatar · Brief (format choice) · Planning · Executing (hero) · Rendered (both ratios) · Component sheet |

Dashboard frames are 1920×1080 — the design is meant to be legible at 1080p,
seen once, by someone who has never used it, because it gets filmed.

Two deliberate splits:

- **The landing page is light; the product is dark.** The marketing reference
  (arcads.ai) is a light site and the product spec is dark-first. Both accents
  are the same blue, so the transition does not break.
- **Node images are real generated frames, vertical.** The tree only works as a
  visual device because the nodes are the images themselves. They are 9:16
  because the output is — for a 16:9 run the nodes follow.

- **The person in the design is generated, not a real customer.** Fine for a
  visual draft; replace before anything ships publicly.

Every number and logo on the landing page is a marked placeholder
(`[YOUR MEASURED RESULT]`, `[CUSTOMER LOGOS]`). Nothing is invented.

## The generation path, and why it is direct

`tools/` holds two working scripts that call Google directly:

| | |
|---|---|
| `gen-image.mjs` | frames, with `--ref` carrying the avatar so the same face survives every scene |
| `gen-video.mjs` | Veo, taking an approved frame as frame one |

Both are verified end to end: a face enrolled at three angles held its likeness
through a completely different scene, and that frame rendered to a 9:16 clip in
42 seconds.

**We evaluated the obvious open-source shortcuts and did not take them.**
[Open-AI-UGC](https://github.com/Anil-matcha/Open-AI-UGC) (MIT, 262★) and
[open-generative-ai](https://github.com/anil-matcha/open-generative-ai)
(MIT, 26.8k★) are both wrappers around **Muapi**, a paid third-party aggregator.
Adopting one would put a middleman in front of a model we already reach
directly, add a subscription, and route every user's face through somebody
else's servers. The second one also stores the API key in the browser
(`localStorage.setItem('muapi_key', …)`) — correct for the desktop app it also
ships as, disqualifying for a hosted product holding *our* key.

What is worth taking from them is the **UI**, not the plumbing. Their studio
components are ~1300 lines each with only ~11 API touchpoints, so the interface
is effectively independent of the layer underneath it. Lifting those and
swapping `lib/muapi.js` for a direct adapter is a real shortcut; adopting the
architecture is not.

## Security

- The key is read **server-side only**. No `NEXT_PUBLIC_` prefix, no
  localStorage, no client component ever sees it.
- `.env` is gitignored; `.env.example` documents the shape and carries nothing.
- The generation scripts never print a request URL, because the URL carries the
  key.

## Status

Design and a verified generation path. No application yet.

To be ported from CareerVivid — its functionality, **none of its UI**: Firebase
wiring, auth, the credit/usage model, and the agent turn-runner, whose
plan → execute → judge → retry loop is the same shape this product needs.

## Layout

```
design/            .dc.html artboards, canvas.json, images, published canvas
tools/             direct Gemini + Veo generation, no aggregator
```
