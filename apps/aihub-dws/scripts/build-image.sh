#!/bin/sh
# Download the pinned dws release (if vendor/ is empty) and build aihub-dws.
# curl honours the caller's https_proxy / http_proxy environment.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$root"

DWS_VERSION="${DWS_VERSION:-v1.0.62}"
DWS_SHA256="${DWS_SHA256:-6198a86570ea52f24d88a58dfe65514540793c4dd64410cb133a8ff7b3b008a8}"
tarball="$root/vendor/dws-linux-amd64.tar.gz"
url="https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli/releases/download/${DWS_VERSION}/dws-linux-amd64.tar.gz"
pkg_version=$(node --input-type=module -e "import { readFileSync } from 'node:fs'; process.stdout.write(JSON.parse(readFileSync('package.json','utf8')).version)")

mkdir -p "$root/vendor"
if [ ! -f "$tarball" ]; then
  partial="${tarball}.partial"
  curl -fL --retry 3 --retry-delay 2 -o "$partial" "$url"
  mv "$partial" "$tarball"
fi
echo "${DWS_SHA256}  ${tarball}" | sha256sum -c -

proxy_http="${HTTP_PROXY:-${http_proxy:-}}"
proxy_https="${HTTPS_PROXY:-${https_proxy:-}}"

docker build \
  --build-arg "DWS_VERSION=${DWS_VERSION}" \
  --build-arg "DWS_SHA256=${DWS_SHA256}" \
  --build-arg "HTTP_PROXY=${proxy_http}" \
  --build-arg "HTTPS_PROXY=${proxy_https}" \
  --build-arg "http_proxy=${http_proxy:-${proxy_http}}" \
  --build-arg "https_proxy=${https_proxy:-${proxy_https}}" \
  -t "aihub-dws:${pkg_version}" \
  -t aihub-dws:latest \
  "$root"
