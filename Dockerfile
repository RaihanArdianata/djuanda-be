FROM oven/bun:1.3-alpine AS base
WORKDIR /repo

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY .npmrc ./

RUN s=1; \
  for i in 1 2 3 4 5 6 7 8; do \
  bun install --frozen-lockfile --network-concurrency 8 && s=0 && break; \
  echo "bun install attempt $i failed, retrying..."; \
  sleep $((i * 5)); \
  done; \
  exit $s

ARG APP_DIR
ENV APP_DIR=${APP_DIR}

WORKDIR /repo/apps/${APP_DIR}

CMD ["bun", "run", "start"]
