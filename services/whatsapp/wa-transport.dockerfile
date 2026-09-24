# Real WhatsApp transport: wppconnect-server built from its official source at a
# pinned commit, then patched by wa-transport-patch.js (env-driven config,
# startAllSession and autoClose disabled). For local development and the demo,
# dev/fake-transport.ts implements the same endpoints without Chromium.
#
# Runtime env:
#   SECRET_KEY   required, same value as WA_TRANSPORT_SECRET_KEY in the whatsapp service
#   WEBHOOK_URL  http://whatsapp:3012/sessions/callback/<WA_WEBHOOK_SECRET>
#                (the secret is in the path because upstream cannot send custom headers)
# Persist /app/userDataDir and /app/tokens in volumes so logins survive restarts.

FROM node:18-slim

# Install Chromium dependencies + git
RUN apt-get update && apt-get install -y \
    git \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    xdg-utils \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Pin wppconnect-server to a specific release ───────────────────────────────
# Tag:    v2.2.5
# Commit: 0f84410fd1e4b1dae42d30aff1332f89def4c72e
#
# Using --depth 1 on a tag still fetches exactly that commit, making the build
# reproducible. The explicit `git checkout` to the full SHA is a second safety
# net: if the tag were ever force-pushed, the checkout would fail rather than
# silently building a different commit.
#
# To upgrade: verify the new tag/SHA on https://github.com/wppconnect-team/wppconnect-server/releases,
# update both the tag and the SHA below, then rebuild.
ARG WPPCONNECT_TAG=v2.2.5
ARG WPPCONNECT_SHA=0f84410fd1e4b1dae42d30aff1332f89def4c72e

RUN git clone --depth 1 --branch ${WPPCONNECT_TAG} \
        https://github.com/wppconnect-team/wppconnect-server.git . \
    && git checkout ${WPPCONNECT_SHA}

# Install dependencies
RUN npm install

# Build TypeScript
RUN npm run build

# See wa-transport-patch.js for what is patched and why.
COPY wa-transport-patch.js ./wa-transport-patch.js
RUN node wa-transport-patch.js

EXPOSE 21465

CMD ["node", "dist/server.js"]
