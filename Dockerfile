# syntax=docker/dockerfile:1

# Sirenix runs as a long-lived Node process: it keeps a websocket open to the
# Capital.com tick feed and owns a SQLite file, so it is built as one image and
# deployed as one always-on container rather than as serverless functions.

ARG NODE_VERSION=22-bookworm-slim

# --- Toolchain shared by every stage that installs dependencies ---------------
# better-sqlite3 ships prebuilt binaries for common platforms and falls back to
# compiling from source; the compiler is here so that fallback cannot fail.
FROM node:${NODE_VERSION} AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# --- Dependencies ------------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Production dependencies, built separately so dev tooling never ships -----
FROM base AS production-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- Build -------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- Runtime -----------------------------------------------------------------
# Stays on the toolchain base: the native SQLite binding was linked against it,
# and the image is the same one the dependencies were built in.
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/signals.db \
    SETTINGS_PATH=/data/settings.json

# Signal history, accounts and settings survive a redeploy only on a mounted
# volume; without one this is an ordinary directory and the container is
# stateless, which is a valid way to run it but loses the history on restart.
VOLUME /data

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY package.json next.config.ts ./

EXPOSE 3000
# Called directly rather than through npm, so the server itself receives the
# stop signal and closes the database cleanly.
CMD ["node_modules/.bin/next", "start"]
