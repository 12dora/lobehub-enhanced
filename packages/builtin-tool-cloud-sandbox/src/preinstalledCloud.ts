import { renderLocalPreinstalledSoftware } from './preinstalled';

/**
 * `<preinstalled_software>` body for the upstream cloud image
 * (`lobehubbot/python-node`, AWS Bedrock AgentCore / Market / Onlyboxes).
 * Injected into the sandbox system role via `{{sandbox_preinstalled_software}}`
 * when the provider is not `local`.
 */
export const cloudPreinstalledSoftware = `<preinstalled_software>
**IMPORTANT: Prefer Pre-installed Software**
The sandbox comes with pre-installed software and libraries. **Always prioritize using these pre-installed tools** when they can solve the user's problem, rather than installing additional packages.

**Base Image:** lobehubbot/python-node:latest (Debian-based)

**Programming Languages & Runtimes:**
- Python (with pip)
- Node.js (with npm)
- Bun
- Bash/Shell

**Package Managers:**
- pip (Python)
- npm / pnpm (Node.js)

**System Tools (apt):**
- curl, wget, unzip, jq - Common utilities
- build-essential - gcc/g++/make compilation toolchain
- FFmpeg - Audio/video processing
- LibreOffice - Office document processing
- Pandoc - Document format conversion
- poppler-utils - PDF tools (pdftotext, pdftoppm, etc.)
- GitHub CLI (gh)

**JS/TS Tools:**
- marp-cli - Markdown to PPT/PDF presentation
- Chromium (installed via Playwright, also used by marp-cli)
- Playwright - Browser automation

**Python Libraries (Pre-installed):**
- Data Science/ML: numpy, pandas, scipy, scikit-learn
- Visualization: matplotlib, plotly
- Data Processing: pyyaml, toml, python-dotenv, Pillow, opencv-python-headless
- File Processing: openpyxl, xlrd, python-docx, PyPDF2, reportlab
- Async: aiofiles, anyio
- Testing: pytest
- Server: fastapi, uvicorn, pydantic

**Fonts:**
- Noto Sans CJK - Chinese/Japanese/Korean sans-serif font
- Noto Serif CJK - Chinese/Japanese/Korean serif font

**NOT Available (do not attempt to use):**
- Tesseract (OCR) - Not installed
- Puppeteer - Not installed, use Playwright instead
- mermaid-cli - Not installed
- seaborn - Not installed

**Installation Guidelines:**
- Only install additional packages when pre-installed software cannot fulfill the requirement
- When Python libraries are already available, use them directly without pip install
- For document generation, prioritize LibreOffice and Pandoc before Python libraries
</preinstalled_software>`;

/**
 * Pick the preinstalled-software prompt for the active sandbox provider.
 * `local` uses the self-hosted image; every other / unknown provider uses the
 * upstream cloud image description.
 */
export const resolvePreinstalledSoftwarePrompt = (provider?: string | null) =>
  provider === 'local' ? renderLocalPreinstalledSoftware() : cloudPreinstalledSoftware;
