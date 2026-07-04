# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# playwright's postinstall downloads browser binaries — skip it: alpine/musl isn't a
# supported Playwright platform, and the download would bloat/possibly fail the build.
# The mockup CAPTURE endpoints therefore no-op in prod until the runtime moves to a
# debian-based (or mcr.microsoft.com/playwright) image — see docs/ROADMAP.md P9.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=4000
WORKDIR /app

# Use non-root user shipped with the node image
USER node

COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node . .

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1

CMD ["node", "index.js"]
