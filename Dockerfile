FROM node:20-slim

ENV NODE_ENV=production \
    BAW_ROOT=/data/baw \
    BAW_BIN=/usr/local/bin/baw

WORKDIR /app

# build tools so @github/keytar can compile, curl for the healthcheck
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# the agentic wallet CLI — fails the build loudly if it cannot install
RUN npm install -g @binance/agentic-wallet@1.12.0 \
 && baw --version

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY keytar-off.mjs ./
COPY src ./src

RUN mkdir -p /data/baw \
 && cp keytar-off.mjs /data/baw/ \
 && chmod 755 /data/baw/keytar-off.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/health" || exit 1

# the volume shadows /data at runtime, so re-seed the hook here too
CMD ["sh", "-c", "mkdir -p \"$BAW_ROOT\"; cp -n ./keytar-off.mjs \"$BAW_ROOT/\" 2>/dev/null; exec ./node_modules/.bin/tsx src/index.ts"]
