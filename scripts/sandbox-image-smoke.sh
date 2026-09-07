#!/usr/bin/env bash
# Smoke-test aihub-sandbox under the same hardening as the local provider:
# uid 1000, read-only rootfs, noexec /tmp, writable HOME=/mnt/data.
# Usage: scripts/sandbox-image-smoke.sh [image]
set -euo pipefail

IMAGE="${1:-aihub-sandbox:latest}"

echo "sandbox-image-smoke: image=${IMAGE}"

ok() { echo "sandbox-image-smoke: $* OK"; }
fail() { echo "sandbox-image-smoke: $*" >&2; exit 1; }

cid="$(
  docker run -d --rm \
    --user 1000:1000 \
    --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=256m \
    --tmpfs /mnt/data:rw,uid=1000,gid=1000,size=512m \
    -e HOME=/mnt/data \
    -e TMPDIR=/tmp \
    "${IMAGE}"
)"
cleanup() { docker rm -f "${cid}" >/dev/null 2>&1 || true; }
trap cleanup EXIT

for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [[ "$(docker inspect -f '{{.State.Running}}' "${cid}" 2>/dev/null || true)" == true ]]; then
    break
  fi
  sleep 0.2
done
[[ "$(docker inspect -f '{{.State.Running}}' "${cid}")" == true ]] \
  || fail "container ${cid} did not start"

hello="$(docker exec "${cid}" tsx -e 'console.log("hello-from-tsx")')"
if [[ "${hello}" != *hello-from-tsx* ]]; then
  fail "expected tsx hello, got: ${hello}"
fi
ok "tsx hello"

docker exec "${cid}" unzip -v >/dev/null
ok "unzip"

docker exec -i "${cid}" python3 <<'PY'
import docx, pptx, openpyxl, odf, fitz, pypdf, docxtpl
from docx import Document
from openpyxl import Workbook
from pptx import Presentation

doc = Document()
doc.add_paragraph('CJK smoke 你好世界')
doc.save('/mnt/data/smoke.docx')

wb = Workbook()
wb.active['A1'] = 'ok'
wb.save('/mnt/data/smoke.xlsx')

prs = Presentation()
prs.slides.add_slide(prs.slide_layouts[5])
prs.save('/mnt/data/smoke.pptx')
print('created')
PY
docker exec "${cid}" test -f /mnt/data/smoke.docx
docker exec "${cid}" test -f /mnt/data/smoke.xlsx
docker exec "${cid}" test -f /mnt/data/smoke.pptx
ok "python office libs"

if ! docker exec "${cid}" timeout 120 soffice --headless --convert-to pdf --outdir /mnt/data /mnt/data/smoke.docx; then
  fail "soffice --headless --convert-to pdf failed or timed out"
fi
docker exec "${cid}" test -f /mnt/data/smoke.pdf || fail "expected /mnt/data/smoke.pdf after soffice"
ok "soffice pdf convert"

docker exec "${cid}" pdftoppm -png -r 40 /mnt/data/smoke.pdf /mnt/data/page
if ! docker exec "${cid}" sh -c 'ls /mnt/data/page*.png >/dev/null 2>&1'; then
  fail "pdftoppm did not produce a PNG under /mnt/data/page*.png"
fi
ok "pdftoppm png"

docker exec "${cid}" pandoc --version >/dev/null
ok "pandoc"

docker exec "${cid}" node -e "require('docx'); require('exceljs'); require('pptxgenjs'); require('mammoth'); require('pdf-lib')"
ok "node office libs"

text="$(docker exec "${cid}" pdftotext /mnt/data/smoke.pdf -)"
if [[ "${text}" != *你好世界* ]]; then
  fail "pdftotext missing CJK string 你好世界; got: ${text}"
fi
ok "cjk round-trip"

echo "sandbox-image-smoke: all ok"
