# syntax=docker/dockerfile:1
#
# Debian-slim base (was alpine): Playwright's chromium needs glibc + OS deps,
# so the mockup CAPTURE endpoints (/api/admin/mockups/*) can run in prod.
# Browsers install to /ms-playwright (root-owned, world-readable) so the
# non-root `node` runtime user can launch them. sharp rebuilds for the
# platform automatically during npm ci.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Browser download happens in the runtime stage (needs apt for OS deps) —
# skip playwright's postinstall here to keep this layer lean.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=4000
# Shared, non-user browser path so USER node can use the root-installed binaries.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
# Chromium + its OS dependencies (as root; --with-deps runs apt-get).
# The mockup controllers already launch with --no-sandbox (required in containers).
RUN npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && chmod -R a+rX /ms-playwright

USER node
COPY --chown=node:node . .

EXPOSE 4000

# bookworm-slim ships no wget/curl — probe /health with node's global fetch.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
