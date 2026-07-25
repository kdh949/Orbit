#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_WORKER_DIR="$ROOT_DIR/services/python-worker"
LOCAL_ENV_FILE="${ORBIT_LOCAL_ENV_FILE:-$ROOT_DIR/.env.local}"
LOCAL_ENV_RUNNER="$ROOT_DIR/infra/scripts/local-development-env.mjs"

cd "$ROOT_DIR"

cleanup() {
  local exit_code=$?

  trap - EXIT INT TERM

  if [[ -n "${NODE_DEV_PID:-}" ]] && kill -0 "$NODE_DEV_PID" 2>/dev/null; then
    kill "$NODE_DEV_PID" 2>/dev/null || true
  fi

  if [[ -n "${PYTHON_DEV_PID:-}" ]] && kill -0 "$PYTHON_DEV_PID" 2>/dev/null; then
    kill "$PYTHON_DEV_PID" 2>/dev/null || true
  fi

  wait "${NODE_DEV_PID:-}" "${PYTHON_DEV_PID:-}" 2>/dev/null || true

  exit "$exit_code"
}

trap cleanup EXIT INT TERM

echo "[dev-up] validating local development environment"
node "$LOCAL_ENV_RUNNER" --env-file "$LOCAL_ENV_FILE" --check

echo "[dev-up] starting local infra containers"
docker compose up -d postgres redis private-evidence-redis minio minio-init
docker compose wait minio-init
docker compose up -d --wait postgres redis private-evidence-redis minio

echo "[dev-up] running API migrations"
node "$LOCAL_ENV_RUNNER" --env-file "$LOCAL_ENV_FILE" -- \
  corepack pnpm --filter @orbit/api migration:run

echo "[dev-up] starting web/api/worker dev processes"
node "$LOCAL_ENV_RUNNER" --env-file "$LOCAL_ENV_FILE" -- corepack pnpm dev &
NODE_DEV_PID=$!

echo "[dev-up] syncing python worker dependencies"
(
  cd "$PYTHON_WORKER_DIR"
  node "$LOCAL_ENV_RUNNER" --env-file "$LOCAL_ENV_FILE" -- uv sync

  echo "[dev-up] starting python worker"
  exec node "$LOCAL_ENV_RUNNER" --env-file "$LOCAL_ENV_FILE" -- \
    sh -c 'exec uv run uvicorn app.main:app --host 0.0.0.0 --port "$PYTHON_WORKER_PORT" --reload'
) &
PYTHON_DEV_PID=$!

while kill -0 "$NODE_DEV_PID" 2>/dev/null && kill -0 "$PYTHON_DEV_PID" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$NODE_DEV_PID" 2>/dev/null; then
  wait "$NODE_DEV_PID"
else
  wait "$PYTHON_DEV_PID"
fi
