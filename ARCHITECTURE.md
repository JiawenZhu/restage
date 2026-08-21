# Architecture — settle this before writing the app

Decisions are marked **DECIDED** where the reason is technical and one-sided,
and **OPEN** where it is a real trade and needs your call.

---

## 1. Framework — **DECIDED: Next.js 16 (App Router) + React 19**

Static HTML cannot carry this product: the version tree grows node by node
while the user watches, so the page has to re-render from live state.

Next.js specifically, not Vite + a separate API, for three reasons:

1. **The studio we are lifting is already App Router.**
   `open-generative-ai` runs Next 15 / React 19 / Tailwind 3. Its
   `ImageStudio` and `VideoStudio` are ~1300 lines each with ~11 API
   touchpoints. Dropped into the same framework they mostly work; ported to
   Vite they get rewritten. We take Next **16** — 16.3.2 is current, 15 is a
   version behind — so expect small adjustments where their components meet
   framework APIs.

   React stays at **19**: 19.2.8 is the current stable release and there is no
   React 20. Everything published above it is a 19.3 canary.
2. **API routes keep the key server-side by default.** Anything under
   `app/api/*` never reaches the browser. That is the fix for the exact defect
   in the project we are borrowing from, which keeps the key in
   `localStorage`.
3. **One deploy target** instead of a frontend host plus a Node service.

CareerVivid is Vite + Firebase Functions. We port its **logic**, not its
runtime — see §7.

## 2. Routing — **DECIDED: file-based App Router**

```
app/
  page.js                    /                 landing (public, static-ish)
  enroll/page.js             /enroll           avatar capture, 3 angles
  studio/page.js             /studio           new run: brief + format + length
  studio/[runId]/page.js     /studio/:runId    plan, tree, inspector, render
  library/page.js            /library          past runs and avatars
  api/
    avatars/route.js                           POST enrol, GET list
    runs/route.js                              POST create a run (writes the plan)
    runs/[id]/route.js                         GET run + nodes
    runs/[id]/events/route.js                  SSE — live node updates
    nodes/[id]/render/route.js                 POST approve a frame → video job
    webhook/veo/route.js                       render completion callback
```

`/studio/:runId` is the screen that gets filmed. It is one route, not a wizard
— the plan, the tree and the inspector are panes of the same page, because the
whole point is that you watch it happen rather than click through steps.

## 3. Long-running work — **DECIDED: job rows + SSE, polling as fallback**

Measured against the real API: **a frame is ~14s, a Veo clip ~41s.** A six-step
plan is therefore ~90s of frames, and a run has to survive a refresh.

- Every generation is a **row**, not an in-memory promise. Refresh, reconnect,
  or come back tomorrow and the run is still there.
- The tree subscribes to `/api/runs/:id/events` (**SSE**) and appends nodes as
  they land. SSE and not WebSocket because the traffic is one-directional.
- Poll `GET /api/runs/:id` every 3s if SSE drops. The borrowed studio already
  polls; we keep that as the fallback rather than the primary.

**This is why the plan runs on frames and not video.** A tree of Veo calls
would be minutes per branch, and the retry loop — the thing that proves
autonomy — would be unwatchable.

## 4. Data — **DECIDED: Firebase for structure, R2 for the video files**

Split by what the thing *is*, not by convenience:

| Lives in | What |
|---|---|
| **Firestore** | profiles, preferences, the taste model, runs, tree nodes, and the **pointer** to each video |
| **Firebase Storage** | avatar captures and generated frames — small, read rarely, tied to a user |
| **Cloudflare R2** | the finished video files |

R2 for video specifically because **egress is free there and $0.12/GB on
Firebase**. A video product stores once and plays many times, so the bill lives
in egress, not storage. Frames and avatars stay on Firebase Storage: they are
small, and keeping them beside the auth that owns them is worth more than the
egress saving on a 20 KB JPEG.

```
users/{uid}                       profile, preferences
users/{uid}/avatars/{id}          three capture paths, label, createdAt
runs/{runId}                      uid, avatarId, goal, aspect, seconds, status
runs/{runId}/nodes/{nodeId}       parentId, stepNo, kind, instruction, rationale,
                                  frameUrl, videoKey → R2, verdict, criticNotes
users/{uid}/taste/{attribute}     weight, sessions
```

**Correcting an earlier recommendation in this document.** It previously argued
for Postgres because the tree is self-referencing and Firestore has no recursive
read. That reasoning holds for large or deep trees and is overweighted here: a
run has six to ten nodes, always scoped to one run. `runs/{id}/nodes` is a
single collection query that returns all of them, and the tree is assembled in
memory. Standing up a second database for a ten-node tree costs more than it
saves.

## 5. Python — **DECIDED: a separate worker, for editing only**

Node calls the models. **Python does not call models** — it edits what comes
back, which is what ffmpeg is for and what Node is bad at.

Its job starts when a run produces more than one clip:

- concatenate several 8s/15s clips into one cut
- captions and burned-in text
- transitions, trims, audio bed
- format conversion, the 16:9 ↔ 9:16 re-render's letterboxing edge cases

```
worker/
  main.py            picks jobs off the queue
  edit/concat.py     ffmpeg concat with re-encode guards
  edit/caption.py    burned-in captions
```

**v1**: Node spawns the script and waits on the exit code — fine at low volume.
**Later**: a real queue (Redis/BullMQ or Cloud Tasks) so a long edit cannot
block a request. Design the interface as a queue from day one — a job row in,
a file out — so the swap is a runner change, not a rewrite.

## 6. Auth — **DECIDED: Firebase Auth, its own project**

Firebase Auth on a **new Firebase project**, separate from CareerVivid's. The
sign-in flow is borrowed from CareerVivid — including the render-gate fix, so
the sign-in page paints before the SDK resolves — but the project, the users and
the data are this product's own.

Firebase Auth rather than NextAuth because the user record and the Firestore
data are then the same identity: `uid` is the document key, and security rules
can be written against `request.auth.uid` without a mapping layer.

## 7. What we port from CareerVivid — logic, never UI

| Take | Why |
|---|---|
| **Credits / usage model** (`shared/credits.ts`) | Unit economics already worked out; a render maps onto it cleanly |
| **Agent turn-runner** (`functions/src/agent/turnRunner.ts`) | Its plan → execute → judge → retry loop is exactly this product's shape |
| **Auth flow** | Including the render-gate fix — the sign-in page must not wait on the SDK before painting |

**Not** its UI. Its Firestore shape, on the other hand, carries over — see §4.

## 8. What we take from `open-generative-ai` (MIT)

**Take:** the studio UI — generation form, model/parameter controls, asset
picker, results gallery, job polling. ~2600 lines of matured interface.

**Replace:** `src/lib/muapi.js` (557 lines) with a direct adapter against
Gemini and Veo. That is one file, and it removes the paid aggregator, the
third-party hop for every user's face, and the browser-stored key in one move.

**Do not take:** the interaction model. Their app is *pick a model, write a
prompt, generate*. Ours is *state an outcome, read the plan, watch it correct
itself*. The tree, the plan panel and the critic are ours — nobody has them,
which is the entire reason the product is interesting.

## 9. Security — non-negotiable

- `GEMINI_API_KEY` is read **only** in `app/api/*`. No `NEXT_PUBLIC_`, no
  `localStorage`, no client component. This is the specific defect in the
  project we are borrowing from.
- `.env` gitignored; `.env.example` carries shape only.
- Never log a request URL — the key is in the query string.
- Avatar captures are biometric-adjacent. Delete-the-avatar must delete the
  captures, and that has to be true on day one, not retrofitted.

---

## Provisioned

- **R2 bucket `video-renders`** — Standard class, **public access disabled**.
  Videos are served through signed URLs or a Worker, never a public bucket, so a
  key in a page source cannot become an open video host. Named by function
  rather than `restage-` because the bucket name is permanent and the product
  name is not.

## Open

1. **R2 API token.** The server needs S3 credentials for that bucket. A token is
   shown once at creation and is a secret, so **you create it** — R2 → Manage
   API tokens → Object Read & Write, scoped to `video-renders` only, not the
   whole account. Paste the values into `.env` yourself; they should not pass
   through a chat log.

2. **Firebase project.** A new one, separate from CareerVivid's.

3. **Theme.** Light is the default and matches Arcads; dark ships behind the
   toggle and gets a pass later to look more premium.
