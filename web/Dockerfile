# Restage on Cloud Run.
#
# An explicit Dockerfile rather than buildpacks. The buildpack build failed with
# a bare "step exited with non-zero status: 51" and no recoverable log, which is
# the wrong trade for a deploy somebody has to debug: this file fails on a line
# you can read.
#
# Three stages so the shipped image carries neither the build toolchain nor the
# dev dependencies.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# `npm ci` rather than `install`: it honours the lockfile exactly, so the image
# gets the versions that were tested rather than whatever resolves today.
RUN npm ci

# ── build ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are compiled into the client bundle, so they have to be
# present at BUILD time — supplied at runtime they are simply absent from the
# JavaScript the browser gets, and Firebase auth fails on a page that looks fine.
ARG NEXT_PUBLIC_FIREBASE_API_KEY
ARG NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
ARG NEXT_PUBLIC_FIREBASE_PROJECT_ID
ARG NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
ARG NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
ARG NEXT_PUBLIC_FIREBASE_APP_ID
ENV NEXT_PUBLIC_FIREBASE_API_KEY=$NEXT_PUBLIC_FIREBASE_API_KEY \
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=$NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN \
    NEXT_PUBLIC_FIREBASE_PROJECT_ID=$NEXT_PUBLIC_FIREBASE_PROJECT_ID \
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=$NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET \
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=$NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID \
    NEXT_PUBLIC_FIREBASE_APP_ID=$NEXT_PUBLIC_FIREBASE_APP_ID \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

# ffmpeg is not optional. lib/finishAd and lib/stitch shell out to it to join
# the per-shot clips, mux the voiceover and burn captions — without it a render
# reaches the last step and dies there, after every Veo clip has been paid for.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Never run as root in a container that executes model output.
RUN groupadd -r app && useradd -r -g app app

# `standalone` traces the files the server actually reaches; static/ and public/
# are not traced and have to come across separately.
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public

USER app
# Documentation only — Cloud Run injects PORT and server.js reads it.
EXPOSE 8080
ENV PORT=8080 HOSTNAME=0.0.0.0

CMD ["node", "server.js"]
