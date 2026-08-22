# Firebase setup

Everything below is on a **new Firebase project**, not CareerVivid's. Same
Google account, separate project: separate users, separate data, separate
billing line, and a mistake in one cannot reach the other.

Steps marked **[you]** need a browser or produce a secret. Steps marked **[cli]**
can be run from here.

---

## 1. Create the project — **[cli]**

```bash
firebase projects:create restage-studio --display-name "Restage"
```

**Done — the project is `restage-studio`.** `restage-app` was already taken by
someone else: GCP project ids are globally unique, not per-account, so they go
the way domains do. The display name is still "Restage"; only the id differs,
exactly as CareerVivid runs under `jastalk-firebase`.

The id is permanent and shows up in the sign-in domain
(`restage-studio.firebaseapp.com`) and the default storage bucket, so it is not
purely internal.

## 2. Turn on the products — **[you]**

Console → your new project. Three things, in this order:

**Authentication** → Get started → **Sign-in method** → enable **Google**.
Set the support email when it asks. Nothing else needs enabling: the product
signs in with Google and only Google, because an avatar tied to a throwaway
email is a moderation problem you do not want on day one.

**Firestore Database** → Create database → **Production mode** (not test mode —
test mode is world-readable for 30 days, and this database holds faces) →
location: pick the one nearest your users and note it, because it is permanent.

**Storage** → Get started → same location as Firestore.

## 3. Register the web app and copy its config — **[you]**

Project settings (gear) → **Your apps** → **Web** (`</>`) → register with
nickname `restage-web`. Do **not** tick Firebase Hosting; the app deploys
elsewhere.

You get a config block. Those values go into `web/.env.local`:

```
apiKey            → NEXT_PUBLIC_FIREBASE_API_KEY
authDomain        → NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
projectId         → NEXT_PUBLIC_FIREBASE_PROJECT_ID
storageBucket     → NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
appId             → NEXT_PUBLIC_FIREBASE_APP_ID
```

**These five are public on purpose.** They ship in the page and that is correct:
Firebase identifies the project with them and protects the data with security
rules, not with secrecy. This is exactly the opposite of `GEMINI_API_KEY` and
`R2_SECRET_ACCESS_KEY`, which must never carry the `NEXT_PUBLIC_` prefix.

## 4. Service account for the server — **[you]**

Project settings → **Service accounts** → **Generate new private key**. A JSON
file downloads.

This one **is** a secret, and a powerful one: it bypasses every security rule.
Two rules for it — do not commit it, and do not paste it into a chat.

Put its contents on one line into `FIREBASE_SERVICE_ACCOUNT_JSON` in
`web/.env.local`:

```bash
# writes it in without printing it
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");require("fs").appendFileSync("web/.env.local","\nFIREBASE_SERVICE_ACCOUNT_JSON="+JSON.stringify(s)+"\n")' ~/Downloads/<the-file>.json
```

Then delete the download.

## 5. Deploy the security rules — **[cli, after 1–3]**

`firestore.rules` and `storage.rules` are already written in this repo. They are
default-deny: every path has to earn access explicitly.

```bash
firebase use restage-studio   # already set in .firebaserc
firebase deploy --only firestore:rules,storage
```

What they enforce, and why:

| Path | Rule | Reason |
|---|---|---|
| `users/{uid}` and `avatars` | owner only | Enrolment captures are biometric-adjacent. No public path, no sharing by link. |
| `users/{uid}/taste/*` | owner **reads**, nobody writes | The taste model is the agent's account of what it learned. A client that can edit it makes "what the agent learned" user-authored. |
| `runs/{id}` update | only `goal`, `status`, `updatedAt` | The plan, the verdicts and the credit cost are the server's record. A client that can rewrite them can fake the run. |
| `runs/{id}/nodes/*` | server writes only | A client that could write a node could award itself a passing critic verdict. |

**Do not skip production mode in step 2.** Test mode leaves the database open to
the world for 30 days.

## 6. Authorised domains — **[you]**

Authentication → Settings → **Authorised domains**. `localhost` is there by
default. Add the production domain when there is one, or Google sign-in fails
there with a redirect error that looks like a code bug and is not.

---

## What ends up where

| | |
|---|---|
| **Firestore** | profiles, preferences, taste model, runs, tree nodes, the R2 key of each video |
| **Firebase Storage** | enrolment captures, generated frames |
| **Cloudflare R2** | finished videos only — private bucket, signed URLs |

## Secret discipline

| Value | Prefix | Where it may appear |
|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | `NEXT_PUBLIC_` | page source — by design |
| `GEMINI_API_KEY` | none | `app/api/*` only |
| `R2_SECRET_ACCESS_KEY` | none | `app/api/*` only |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | none | `app/api/*` only |

`lib/gemini.ts` and `lib/r2.ts` throw on import in a browser rather than trusting
this table to be followed.

---

# Deploying

Everything below has been exercised against the live `restage-studio` project.

## Before every deploy

```bash
cd web && npx tsc --noEmit && npm run build && npx tsx scripts/check-health.mts
```

`check-health.mts` asserts six invariants that have each broken during
development, and each failure was silent when it happened:

| Check | The failure it guards |
|---|---|
| Firestore writable | credentials expired or wrong project |
| FieldValue sentinels survive | a JSON round-trip turned `increment(1)` into the map `{operand: 1}`, so a counter silently stopped counting |
| Storage private, tokened URLs read | locking the bucket blanked every image in the app; a bare `?alt=media` URL only worked because the bucket was world-readable |
| Spend ceiling holds under concurrency | a read-then-write counter lets parallel requests past the limit |
| Composite index deployed | without it the library query throws — and the old handler answered that throw by returning *every user's* runs |
| No run document near 1MB | one reached 1,333,473 bytes and became permanently unwritable, unable even to mark itself failed |

## Rules and indexes

Rules and indexes are **not** part of `next build` and are easy to forget:

```bash
npx firebase deploy --only firestore:rules,firestore:indexes,storage --project restage-studio
```

The Firestore index backs `where('uid','==',…).orderBy('createdAt','desc')` — the
library's only query. Deploy it *before* the code that depends on it.

## Environment

`web/.env.local` is git-ignored and never committed. The server-only values
(`GEMINI_API_KEY`, the R2 keys, `FIREBASE_SERVICE_ACCOUNT`) must not gain a
`NEXT_PUBLIC_` prefix — that would bundle them into page source, which rotating
the key afterwards does not undo.

`RESTAGE_DEV_UID` is a development convenience that skips token verification. It
is unreachable in a production build: `NODE_ENV === 'development'` is a compile
-time constant there, so the branch is eliminated entirely — verified by grepping
the build output, where only an inert `process.env.RESTAGE_DEV_UID` expression
remains.

## Regenerating template previews

```bash
cd web && npx tsx scripts/make-template-previews.mts [templateId …]
```

Each template costs one image plus one Veo render (~75s). Existing files are
skipped so an interrupted run resumes, a lock file prevents two generators
double-spending, and the script rewrites `lib/templatePreviews.ts` from what is
actually on disk — so a partial run leaves the gallery telling the truth about
which cards can be hovered.

## Repairing data

```bash
cd web && npx tsx scripts/repair-runs.mts
```

Strips inline payloads that push a run document over the 1MB limit, un-corrupts
`frameCount`/`previewFrames` values that were written as serialized sentinels,
and backfills the summary the library reads.

## Known limits

- **Clips are 4–8 seconds.** The model's own words: *"Please provide a value between 4 and 8, inclusive."* Longer output needs several renders stitched together — the Python worker's first job, not built.
- **Identity drift is only partly caught.** The critic reliably rejects a different person; subtle drift needs face-embedding comparison (ArcFace-class). Until then the human Reject is the last line, which is why it is a first-class control.
- **The enrolled voice sample is stored and unused.** Clips use a synthetic voice reading a written line, which is shown to the user before rendering. `/likeness` says so.
