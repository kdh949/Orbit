FROM node:24-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.12.4 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/font-assets/package.json packages/font-assets/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/editor-core/package.json packages/editor-core/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/job-queue/package.json packages/job-queue/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/realtime/package.json packages/realtime/package.json

RUN pnpm install --frozen-lockfile

COPY . .
ARG APP_ENV=local
ARG API_BASE_URL=http://api:3000
ARG WEB_PORT=5173
ENV APP_ENV=$APP_ENV
ENV API_BASE_URL=$API_BASE_URL
ENV WEB_PORT=$WEB_PORT
RUN pnpm --filter @orbit/web... --workspace-concurrency=1 build

EXPOSE 5173

CMD ["pnpm", "--filter", "@orbit/web", "preview"]
