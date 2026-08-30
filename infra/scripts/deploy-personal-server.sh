#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${ORBIT_APP_DIR:-/var/www/orbit}"
DEPLOY_BRANCH="${ORBIT_DEPLOY_BRANCH:-develop}"
LOCK_FILE="${ORBIT_DEPLOY_LOCK_FILE:-/tmp/orbit-personal-server-deploy.lock}"
FIRST_ARGUMENT="${1:-}"

if [[ "$FIRST_ARGUMENT" =~ ^[0-9a-f]{40}$ ]]; then
  DEPLOYMENT_MODE="full"
  EXPECTED_SHA="$FIRST_ARGUMENT"
else
  DEPLOYMENT_MODE="${FIRST_ARGUMENT:-full}"
  EXPECTED_SHA="${2:-}"
fi

COMPOSE=(
  docker compose
  -f docker-compose.yml
  -f docker-compose.staging.yml
)

cd "$APP_DIR"

if [[ "$DEPLOYMENT_MODE" != "full" && "$DEPLOYMENT_MODE" != "environment-only" ]]; then
  echo "Invalid deployment mode."
  exit 1
fi

if [[ -n "$EXPECTED_SHA" && ! "$EXPECTED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "Invalid expected deployment SHA."
  exit 1
fi

if [[ "$DEPLOYMENT_MODE" == "environment-only" && -z "$EXPECTED_SHA" ]]; then
  echo "Environment-only deployment requires an expected SHA."
  exit 1
fi

if [[ "$DEPLOYMENT_MODE" == "full" && -z "$EXPECTED_SHA" ]]; then
  echo "Full deployment requires an expected SHA."
  exit 1
fi

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another deployment is already running."
  exit 1
fi

if [[ "$DEPLOYMENT_MODE" == "full" ]]; then
  git switch "$DEPLOY_BRANCH"
  git pull --ff-only origin "$DEPLOY_BRANCH"
fi

if [[ -n "$EXPECTED_SHA" && "$(git rev-parse HEAD)" != "$EXPECTED_SHA" ]]; then
  echo "Server HEAD does not match the requested develop SHA. Deployment refused."
  exit 1
fi

DEPLOY_SHA="$(git rev-parse HEAD)"
IMAGE_TAG="$DEPLOY_SHA"
export IMAGE_TAG

verify_app_images() {
  local resolved_images
  local image
  local -a app_images

  resolved_images="$(doppler run -- "${COMPOSE[@]}" config --images)"
  app_images=()
  while IFS= read -r image; do
    if [[ -n "$image" ]]; then
      app_images+=("$image")
    fi
  done < <(
    printf '%s\n' "$resolved_images" |
      grep -E '/orbit-(api|worker|python-worker|web):' || true
  )

  if [[ "${#app_images[@]}" -ne 4 ]]; then
    echo "Expected exactly four personal staging app images, found ${#app_images[@]}."
    return 1
  fi

  for image in "${app_images[@]}"; do
    if ! docker image inspect "$image" >/dev/null 2>&1; then
      echo "Required personal staging app image is not available locally: $image"
      return 1
    fi
  done
}

doppler run -- bash infra/scripts/check-personal-staging-env.sh
doppler run -- "${COMPOSE[@]}" config --quiet

if [[ "$DEPLOYMENT_MODE" == "environment-only" ]]; then
  verify_app_images
  doppler run -- "${COMPOSE[@]}" run --rm --no-deps api \
    node -e 'const { loadOrbitConfig } = require("/app/packages/config/dist/index.js"); loadOrbitConfig(process.env, { service: "api" });'
  doppler run -- "${COMPOSE[@]}" run --rm --no-deps worker \
    node -e 'const { loadOrbitConfig } = require("/app/packages/config/dist/index.js"); loadOrbitConfig(process.env, { service: "worker" });'
  doppler run -- "${COMPOSE[@]}" run --rm --no-deps python-worker \
    uv run python -c 'from app.config import load_config; load_config()'
  doppler run -- "${COMPOSE[@]}" up -d --no-build --pull never --force-recreate api worker python-worker web
else
  # GitHub-hosted Actions publishes all four images with the same immutable
  # commit SHA. The personal server only pulls those images; it never builds
  # application images on-box.
  ghcr_token="${GHCR_TOKEN:-}"
  if [ -z "$ghcr_token" ]; then
    ghcr_token="$(doppler secrets get GHCR_TOKEN --plain 2>/dev/null || true)"
  fi
  if [ -z "$ghcr_token" ]; then
    echo "GHCR_TOKEN with read:packages is required for personal staging deployment."
    exit 1
  fi

  ghcr_user="${GHCR_USERNAME:-$(doppler secrets get GHCR_USERNAME --plain 2>/dev/null || echo kdh949)}"
  docker_config_directory="$(mktemp -d)"
  export DOCKER_CONFIG="$docker_config_directory"
  trap 'rm -rf "$docker_config_directory"' EXIT
  printf '%s' "$ghcr_token" | docker login ghcr.io -u "$ghcr_user" --password-stdin

  pull_attempts="${REGISTRY_PULL_ATTEMPTS:-10}"
  pull_interval_seconds="${REGISTRY_PULL_INTERVAL_SECONDS:-15}"
  if ! [[ "$pull_attempts" =~ ^[1-9][0-9]*$ ]]; then
    echo "REGISTRY_PULL_ATTEMPTS must be a positive integer."
    exit 1
  fi
  if ! [[ "$pull_interval_seconds" =~ ^[0-9]+$ ]]; then
    echo "REGISTRY_PULL_INTERVAL_SECONDS must be a non-negative integer."
    exit 1
  fi

  images_pulled=false
  for attempt in $(seq 1 "$pull_attempts"); do
    if doppler run -- "${COMPOSE[@]}" pull api worker python-worker web; then
      images_pulled=true
      break
    fi
    if [ "$attempt" -lt "$pull_attempts" ]; then
      echo "Images for ${IMAGE_TAG} are not ready; retrying ${attempt}/${pull_attempts}."
      sleep "$pull_interval_seconds"
    fi
  done
  if [ "$images_pulled" != "true" ]; then
    echo "Required GHCR images for ${IMAGE_TAG} could not be pulled."
    exit 1
  fi

  verify_app_images
  doppler run -- "${COMPOSE[@]}" up -d postgres redis minio minio-init
  doppler run -- "${COMPOSE[@]}" run --rm --pull never api corepack pnpm db:migration:run
  doppler run -- "${COMPOSE[@]}" up -d --no-build --pull never
fi

for attempt in $(seq 1 30); do
  if curl -fsS http://127.0.0.1/api/health >/dev/null && curl -fsS http://127.0.0.1/ >/dev/null; then
    doppler run -- "${COMPOSE[@]}" ps
    exit 0
  fi

  echo "Waiting for services to become healthy... attempt ${attempt}/30"
  sleep 2
done

echo "Deployment finished, but health checks did not pass in time."
doppler run -- "${COMPOSE[@]}" ps
exit 1
