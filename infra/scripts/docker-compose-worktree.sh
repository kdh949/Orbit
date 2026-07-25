#!/usr/bin/env bash

set -euo pipefail

worktree_path="${CODEX_WORKTREE_PATH:-$(git rev-parse --show-toplevel)}"
worktree_hash="$(printf '%s' "$worktree_path" | git hash-object --stdin | cut -c1-12)"
project_name="${COMPOSE_PROJECT_NAME:-orbit-worktree-${worktree_hash}}"
port_slot="$((16#${worktree_hash:0:6} % 4000))"
port_base="$((20000 + port_slot * 10))"

export WEB_HOST_PORT="${WEB_HOST_PORT:-$port_base}"
export API_PORT="${API_PORT:-$((port_base + 1))}"
export PYTHON_WORKER_PORT="${PYTHON_WORKER_PORT:-$((port_base + 2))}"
export POSTGRES_HOST_PORT="${POSTGRES_HOST_PORT:-$((port_base + 3))}"
export REDIS_HOST_PORT="${REDIS_HOST_PORT:-$((port_base + 4))}"
export PRIVATE_EVIDENCE_REDIS_HOST_PORT="${PRIVATE_EVIDENCE_REDIS_HOST_PORT:-$((port_base + 5))}"
export MINIO_HOST_PORT="${MINIO_HOST_PORT:-$((port_base + 6))}"
export MINIO_CONSOLE_HOST_PORT="${MINIO_CONSOLE_HOST_PORT:-$((port_base + 7))}"
export WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:${WEB_HOST_PORT}}"
export S3_PUBLIC_ENDPOINT="${S3_PUBLIC_ENDPOINT:-http://localhost:${MINIO_HOST_PORT}}"

if [[ "${1:-}" == "--print-project-name" ]]; then
  printf '%s\n' "$project_name"
  exit 0
fi

if [[ "${1:-}" == "--print-port-env" ]]; then
  printf 'WEB_HOST_PORT=%s\n' "$WEB_HOST_PORT"
  printf 'API_PORT=%s\n' "$API_PORT"
  printf 'PYTHON_WORKER_PORT=%s\n' "$PYTHON_WORKER_PORT"
  printf 'POSTGRES_HOST_PORT=%s\n' "$POSTGRES_HOST_PORT"
  printf 'REDIS_HOST_PORT=%s\n' "$REDIS_HOST_PORT"
  printf 'PRIVATE_EVIDENCE_REDIS_HOST_PORT=%s\n' "$PRIVATE_EVIDENCE_REDIS_HOST_PORT"
  printf 'MINIO_HOST_PORT=%s\n' "$MINIO_HOST_PORT"
  printf 'MINIO_CONSOLE_HOST_PORT=%s\n' "$MINIO_CONSOLE_HOST_PORT"
  exit 0
fi

cd "$worktree_path"
export COMPOSE_PROJECT_NAME="$project_name"
exec docker compose "$@"
