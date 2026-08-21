# Firebase setup

Everything below is on a **new Firebase project**, not CareerVivid's. Same
Google account, separate project: separate users, separate data, separate
billing line, and a mistake in one cannot reach the other.

Steps marked **[you]** need a browser or produce a secret. Steps marked **[cli]**
can be run from here.

---

## 1. Create the project — **[cli]**

```bash
firebase projects:create restage-app --display-name "Restage"
```

`restage-app` may be taken; if so Firebase will say so and you pick another. The
project id is **permanent** and appears in URLs and bucket names, so choose it
the way you would choose a domain.

This creates a real Google Cloud project under your account. It costs nothing on
its own, but it is a real resource — say the word and I will run it.

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
firebase use <project-id>
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
