FROM node:24-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/editor-core/package.json packages/editor-core/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/job-queue/package.json packages/job-queue/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/realtime/package.json packages/realtime/package.json

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @orbit/worker... --workspace-concurrency=1 build

CMD ["node", "--enable-source-maps", "apps/worker/dist/main.js"]
