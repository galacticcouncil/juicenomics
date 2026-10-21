#!/usr/bin/env bash
# build and push the image from a logged-in docker host, then update the lark stack and wait for it
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "commit first: the image is tagged with the commit" >&2; exit 1; }
REV=$(git rev-parse HEAD)
TOKEN_FILE=${SWARMPIT_TOKEN_FILE:-$HOME/.lark_token}
docker build --build-arg VCS_REF="$REV" -t "galacticcouncil/juicenomics:$REV" .
docker push "galacticcouncil/juicenomics:$REV" >/dev/null
DIGEST=$(docker inspect --format '{{index .RepoDigests 0}}' "galacticcouncil/juicenomics:$REV" | cut -d@ -f2)
SWARMPIT_TOKEN="$(cat "$TOKEN_FILE")" DEPLOY_IMAGE="galacticcouncil/juicenomics:$REV@$DIGEST" DEPLOY_REVISION="$REV" node scripts/deploy-lark.mjs
