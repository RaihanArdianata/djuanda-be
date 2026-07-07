FROM oven/bun:1.3-alpine AS base
WORKDIR /repo

COPY package.json bun.lock ./
COPY apps ./apps
COPY packages ./packages

RUN bun install --frozen-lockfile

ARG APP_DIR
ENV APP_DIR=${APP_DIR}

WORKDIR /repo/apps/${APP_DIR}

CMD ["bun", "run", "start"]
