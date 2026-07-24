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
IMAGE_TAG="$DEPLOY_BRANCH"
WEB_IMAGE_TAG="$DEPLOY_SHA"
export IMAGE_TAG WEB_IMAGE_TAG

verify_app_images() {
  local resolved_images
  local image
  local -a app_images

  resolved_images="$(doppler run -- "${COMPOSE[@]}" config --images)"
  mapfile -t app_images < <(
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
  # Prepare service images. Use prebuilt GHCR images when a GHCR token is
  # available; otherwise fall back to building on-box so deploys keep working
  # before the token is configured. Set the GHCR_TOKEN (and optional
  # GHCR_USERNAME) secrets in Doppler to make the registry path the default for
  # personal staging. Set DEPLOY_USE_REGISTRY=false to force the on-box build.
  # The web image is staging-specific but prebuilt in CI (build-images.yml,
  # develop only); pull it too and fall back to an on-box build if the tag is
  # missing. See docs/runbooks/deploy-image-registry-migration.md.
  ghcr_token="${GHCR_TOKEN:-${GITHUB_TOKEN:-}}"
  if [ -z "$ghcr_token" ]; then
    ghcr_token="$(doppler secrets get GHCR_TOKEN --plain 2>/dev/null || true)"
  fi
  if [ "${DEPLOY_USE_REGISTRY:-auto}" != "false" ] && [ -n "$ghcr_token" ]; then
    IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
    # Use the branch tag (e.g. develop) rather than the exact commit SHA:
    # commits that touch only scripts or docs do not trigger build-images, so
    # a per-SHA tag may not exist, while the branch tag always points at the
    # latest built app image.
    ghcr_user="${GHCR_USERNAME:-$(doppler secrets get GHCR_USERNAME --plain 2>/dev/null || echo orbit-deploy)}"
    printf '%s' "$ghcr_token" | docker login "$IMAGE_REGISTRY" -u "$ghcr_user" --password-stdin
    doppler run -- "${COMPOSE[@]}" pull api worker python-worker
    # Pin the web image to the exact deployed commit rather than the branch tag.
    # The web bundle bakes in the frontend, so a stale bundle against a newer API
    # can break the UI. The automatic develop-push deploy does not wait for
    # build-images, so the branch tag may still point at the previous build when
    # a web-changing commit deploys. Pull the per-SHA tag and fall back to an
    # on-box build when it is missing (build not finished, or a commit that did
    # not trigger build-web).
    if ! doppler run -- "${COMPOSE[@]}" pull web; then
      echo "web image ${WEB_IMAGE_TAG} not available; building web on-box as a fallback."
      doppler run -- "${COMPOSE[@]}" build web
    fi
  else
    doppler run -- "${COMPOSE[@]}" build
  fi
  verify_app_images
  doppler run -- "${COMPOSE[@]}" up -d postgres redis minio minio-init
  doppler run -- "${COMPOSE[@]}" run --rm api corepack pnpm db:migration:run
  doppler run -- "${COMPOSE[@]}" up -d --pull never
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
