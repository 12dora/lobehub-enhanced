/**
 * Software baked into the self-hosted local sandbox image (`Dockerfile.sandbox`,
 * `SANDBOX_PROVIDER=local`). Single source of truth shared by:
 *   - the sandbox system role (`{{sandbox_preinstalled_software}}` placeholder),
 *   - the admin sandbox settings card (preinstalled package counts),
 *   - the Dockerfile drift tests under `apps/server/src/services/sandbox`.
 *
 * Keep every list alphabetical and identical to the install blocks in the
 * Dockerfile (pip names lowercase / pip-normalized, npm names as published).
 */

/** Debian packages installed with apt (`Dockerfile.sandbox`, apt block). */
export const SANDBOX_LOCAL_APT_PACKAGES = [
  'build-essential',
  'ca-certificates',
  'curl',
  'file',
  'fonts-dejavu-core',
  'fonts-liberation',
  'fonts-noto-cjk',
  'git',
  'jq',
  'libreoffice-calc',
  'libreoffice-impress',
  'libreoffice-writer',
  'pandoc',
  'poppler-utils',
  'unzip',
  'wget',
] as const;

/** Global npm packages (`npm install -g`), resolvable via NODE_PATH. */
export const SANDBOX_LOCAL_NPM_PACKAGES = [
  'docx',
  'exceljs',
  'mammoth',
  'pdf-lib',
  'pptxgenjs',
  'tsx',
] as const;

/** Pip packages (`pip install --no-cache-dir` block). */
export const SANDBOX_LOCAL_PIP_PACKAGES = [
  'beautifulsoup4',
  'chardet',
  'defusedxml',
  'docxcompose',
  'docxtpl',
  'lxml',
  'matplotlib',
  'numpy',
  'odfpy',
  'openpyxl',
  'pandas',
  'pdf2image',
  'pdfplumber',
  'pillow',
  'pymupdf',
  'pypdf',
  'python-dateutil',
  'python-docx',
  'python-pptx',
  'pyyaml',
  'reportlab',
  'requests',
  'scipy',
  'tabulate',
  'xlrd',
  'xlsxwriter',
] as const;

export type SandboxLocalPipPackage = (typeof SANDBOX_LOCAL_PIP_PACKAGES)[number];

/**
 * `<preinstalled_software>` body for the LOCAL image. Rendered into the sandbox
 * system role in place of the upstream cloud-image description.
 */
export const renderLocalPreinstalledSoftware = (): string => `<preinstalled_software>
**IMPORTANT: Prefer Pre-installed Software**
The sandbox image is built from \`Dockerfile.sandbox\` (python:3.12-slim, Debian) and already contains everything below. The root filesystem is read-only and \`/tmp\` is mounted noexec, so \`apt-get\`, \`npm install -g\` and system-wide \`pip install\` do NOT work at run time. Use the preinstalled software; only fall back to \`pip install --user <pkg>\` for pure-Python packages that are genuinely missing.

**Runtimes:** Python 3.12 (python3 / pip), Node.js 22 (node / npm, TypeScript via \`tsx\`), Bash/sh.

**System tools (apt):**
- LibreOffice (writer, calc, impress) - \`soffice --headless --convert-to pdf|docx|xlsx|pptx|odt ... --outdir <dir> <file>\` for Office <-> PDF/OpenDocument conversion and rendering
- Pandoc - Markdown/HTML <-> DOCX/ODT conversion (\`pandoc in.md -o out.docx\`)
- poppler-utils - \`pdftoppm\` (PDF pages -> PNG previews), \`pdftotext\`
- Fonts: Noto Sans/Serif CJK, Liberation, DejaVu (CJK text renders correctly in PDF exports)
- curl, wget, unzip, jq, git, file (libmagic), build-essential

**Python libraries (pre-installed, do not pip install):**
- Word: python-docx, docxtpl (templating), docxcompose (merge documents)
- Excel: openpyxl, xlsxwriter, xlrd, pandas
- PowerPoint: python-pptx
- OpenDocument: odfpy
- PDF: pypdf, pdfplumber, pymupdf (import fitz), reportlab, pdf2image
- Data / charts: numpy, pandas, scipy, matplotlib, tabulate
- Misc: pillow, lxml, beautifulsoup4, requests, chardet, pyyaml, python-dateutil, defusedxml

**Node.js libraries (global, \`require()\`-able from any directory via NODE_PATH):**
- docx (Word), exceljs (Excel), pptxgenjs (PowerPoint), mammoth (DOCX -> HTML/text), pdf-lib (PDF)

**Not available:** Chromium/Playwright/Puppeteer, marp-cli, FFmpeg, GitHub CLI, Tesseract OCR, Bun/pnpm, Java.

**Office document guidance:**
- Create/edit DOCX with python-docx (or the \`docx\` npm package), XLSX with openpyxl/xlsxwriter (or exceljs), PPTX with python-pptx (or pptxgenjs).
- Convert any Office file to PDF with LibreOffice: \`soffice --headless --convert-to pdf --outdir /mnt/data <file>\`; render preview images with \`pdftoppm -png -r 80 file.pdf page\`.
- Save deliverables under /mnt/data and hand them to the user with \`exportFile\`.
</preinstalled_software>`;
