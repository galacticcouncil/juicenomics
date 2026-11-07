#!/usr/bin/env bash
# build and push the image from a logged-in docker host, then update the lark stack and wait for it
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "commit first: the image is tagged with the commit" >&2; exit 1; }
TARGET=${1:-production}
case "$TARGET" in
  production) SUFFIX=""; DEFAULT_TAB=overview ;;
  two-strategy) SUFFIX=-two-strategy; DEFAULT_TAB=strategies ;;
  vdot) SUFFIX=-vdot; DEFAULT_TAB=vdot ;;
  *) echo "usage: scripts/publish-lark.sh [production|two-strategy|vdot]" >&2; exit 1 ;;
esac
REV=$(git rev-parse HEAD)
TOKEN_FILE=${SWARMPIT_TOKEN_FILE:-$HOME/.lark_token}
IMAGE="galacticcouncil/juicenomics:$REV$SUFFIX"
docker build --build-arg VCS_REF="$REV" --build-arg APP_DEFAULT_TAB="$DEFAULT_TAB" -t "$IMAGE" .
docker push "$IMAGE" >/dev/null
DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "$IMAGE" | cut -d@ -f2)
SWARMPIT_TOKEN_FILE="$TOKEN_FILE" DEPLOY_TARGET="$TARGET" DEPLOY_IMAGE="$IMAGE@$DIGEST" DEPLOY_REVISION="$REV" node scripts/deploy-lark.mjs
