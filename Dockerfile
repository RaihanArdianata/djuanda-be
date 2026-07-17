FROM oven/bun:1.3-alpine AS base
WORKDIR /repo

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages
COPY .npmrc ./

RUN s=1; \
  for i in 1 2 3; do \
  bun install --frozen-lockfile && s=0 && break; \
  echo "bun install attempt $i failed, retrying..."; \
  sleep 5; \
  done; \
  exit $s

ARG APP_DIR
ENV APP_DIR=${APP_DIR}

WORKDIR /repo/apps/${APP_DIR}

CMD ["bun", "run", "start"]
