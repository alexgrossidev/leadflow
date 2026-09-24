# One image definition for every service: docker build --build-arg SERVICE=gateway .
#
# The build stage bundles the service (and the @leadflow/* workspace packages it
# uses) into a single dist/main.js; the runtime stage ships that bundle plus
# production node_modules only, running as the unprivileged `node` user.

FROM node:22-bookworm-slim AS base
WORKDIR /app

# ── Full workspace install, used to build and by the dev-only tools target ────
FROM base AS build
COPY . .
RUN npm ci --no-audit --no-fund
ARG SERVICE
RUN test -n "$SERVICE" || (echo "SERVICE build-arg is required" && exit 1)
RUN npm run build --workspace=@leadflow/${SERVICE}

# ── Production dependencies only ─────────────────────────────────────────────
FROM base AS prod-deps
COPY . .
RUN npm ci --omit=dev --no-audit --no-fund

# ── Dev tools (fake WhatsApp transport, mock Graph API, webhook simulator) ────
FROM build AS tools
USER node
CMD ["npx", "tsx", "--version"]

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
ARG SERVICE
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/services/${SERVICE}/package.json ./package.json
COPY --from=build /app/services/${SERVICE}/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/main.js"]
