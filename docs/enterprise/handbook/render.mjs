#!/usr/bin/env node
/**
 * Render the DingTalk AI employee handbook to an A4 PDF.
 *
 *   cd /data/dev/lobehub-enhanced && node docs/enterprise/handbook/render.mjs
 *
 * - Uses Playwright's Chromium. If the build pinned by the installed Playwright
 *   is not downloaded, the newest build already in ~/.cache/ms-playwright is
 *   used instead (nothing is installed).
 * - Fonts: the host has no system fonts at all, so every glyph comes from the
 *   static Noto Sans SC subsets in fonts/ (built by subset-fonts.py; rebuild
 *   them after changing the handbook text). With no system font to fall back
 *   on, headless Chromium here marks a web font as failed when page layout
 *   triggers its load, while an explicit FontFace.load() of the same file
 *   succeeds. The script therefore re-adds every @font-face rule through the
 *   FontFace API before printing, and fails if a face does not load.
 * - Footer: page numbers are drawn with CSS page-margin boxes (@page
 *   @bottom-left / @bottom-right in the HTML). Chromium's displayHeaderFooter
 *   templates render in a separate document that cannot load web fonts, so on
 *   this host they would print nothing — not even digits.
 * - Table of contents: two passes. The first PDF is scanned with pdf.js for
 *   each chapter's 「第 N 章」 marker; the numbers are written into the TOC and
 *   the PDF is rendered again until the page numbers are stable.
 */
import { existsSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from '@playwright/test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, 'dingtalk-ai-handbook.html');
const pdfPath = path.join(here, 'dingtalk-ai-handbook.pdf');
const FONT_FAMILY = 'Noto Sans SC';

const pdfOptions = {
  displayHeaderFooter: false,
  format: 'A4',
  outline: true,
  preferCSSPageSize: true,
  printBackground: true,
  tagged: true,
};

/**
 * Chromium builds already in the Playwright cache (or CHROMIUM_EXECUTABLE).
 * Headless-shell builds come first: they need fewer system libraries.
 */
const cachedChromiumCandidates = () => {
  if (process.env.CHROMIUM_EXECUTABLE) return [process.env.CHROMIUM_EXECUTABLE];
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return [];
  return readdirSync(cache)
    .map((name) => {
      const shell = /^chromium_headless_shell-(\d+)$/.exec(name);
      if (shell) {
        return {
          exe: path.join(cache, name, 'chrome-headless-shell-linux64/chrome-headless-shell'),
          rank: 1,
          rev: Number(shell[1]),
        };
      }
      const full = /^chromium-(\d+)$/.exec(name);
      if (full) {
        return {
          exe: path.join(cache, name, 'chrome-linux64/chrome'),
          rank: 0,
          rev: Number(full[1]),
        };
      }
      return null;
    })
    .filter((item) => item && existsSync(item.exe))
    .sort((a, b) => b.rank - a.rank || b.rev - a.rev)
    .map((item) => item.exe);
};

/**
 * Chromium's shared libraries (libatk, libgbm, …) are not installed system-wide
 * on this host; an extracted copy lives under /data/tmp. Override with
 * CHROMIUM_LIB_DIR.
 */
const CHROMIUM_LIB_DIR =
  process.env.CHROMIUM_LIB_DIR || '/data/tmp/ubuntu/pw-libs/root/usr/lib/x86_64-linux-gnu';

const launchEnv = () => {
  if (!existsSync(CHROMIUM_LIB_DIR)) return process.env;
  const current = process.env.LD_LIBRARY_PATH;
  return {
    ...process.env,
    LD_LIBRARY_PATH: current ? `${CHROMIUM_LIB_DIR}:${current}` : CHROMIUM_LIB_DIR,
  };
};

const launchBrowser = async () => {
  const env = launchEnv();
  try {
    return await chromium.launch({ env });
  } catch (error) {
    const failures = [];
    for (const executablePath of cachedChromiumCandidates()) {
      try {
        const browser = await chromium.launch({ env, executablePath });
        console.warn(`Pinned Chromium unavailable; using ${executablePath}`);
        return browser;
      } catch (fallbackError) {
        failures.push(`${executablePath}: ${String(fallbackError.message).split('\n')[0]}`);
      }
    }
    if (failures.length > 0) console.error(failures.join('\n'));
    throw error;
  }
};

/**
 * Load every @font-face rule of the page explicitly (see the header comment)
 * and prove that CJK text has width. Throws if a face fails to load.
 */
const loadFonts = async (page) => {
  const result = await page.evaluate(async (family) => {
    const rules = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .filter((rule) => rule instanceof CSSFontFaceRule);
    const faces = await Promise.all(
      rules.map(async (rule) => {
        const descriptor = (name) => rule.style.getPropertyValue(name) || undefined;
        const face = new FontFace(
          descriptor('font-family').replaceAll(/["']/g, ''),
          descriptor('src'),
          { style: descriptor('font-style'), weight: descriptor('font-weight') },
        );
        try {
          await face.load();
          document.fonts.add(face);
          return `${face.weight}:loaded`;
        } catch {
          return `${face.weight}:error`;
        }
      }),
    );
    await document.fonts.ready;
    const probe = document.createElement('span');
    probe.textContent = '钉钉手册';
    probe.style.font = `20px "${family}"`;
    document.body.append(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return { faces, width };
  }, FONT_FAMILY);
  const failed = result.faces.filter((face) => !face.endsWith(':loaded'));
  if (result.faces.length === 0 || failed.length > 0 || !(result.width > 0)) {
    throw new Error(
      `${FONT_FAMILY} subsets did not load (${result.faces.join(', ') || 'no @font-face rules'}); run subset-fonts.py`,
    );
  }
};

const normalize = (text) => text.replaceAll(/\s+/g, '');

/** Page text for every page, whitespace removed. */
const pageTexts = async (buffer) => {
  const doc = await getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;
  const texts = [];
  for (let index = 1; index <= doc.numPages; index += 1) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    texts.push(normalize(content.items.map((item) => item.str ?? '').join('')));
  }
  await doc.destroy();
  return texts;
};

/** Map each TOC target to the first page (1-based) that carries its marker, in order. */
const locateChapters = (texts, entries) => {
  const pages = {};
  let from = 0;
  for (const { id, marker } of entries) {
    const needle = normalize(marker);
    const index = texts.findIndex((text, i) => i >= from && text.includes(needle));
    if (index === -1) throw new Error(`Chapter marker not found in PDF: ${marker}`);
    pages[id] = index + 1;
    from = index + 1;
  }
  return pages;
};

const main = async () => {
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    await loadFonts(page);

    const entries = await page.$$eval('a.toc-item', (links) =>
      links.map((link) => ({
        id: link.getAttribute('href').slice(1),
        marker: link.dataset.marker,
      })),
    );

    let buffer = await page.pdf(pdfOptions);
    let pages = locateChapters(await pageTexts(buffer), entries);

    // Fill page numbers, re-render, and repeat until the layout is stable.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.evaluate((map) => {
        for (const [id, number] of Object.entries(map)) {
          const cell = document.querySelector(`[data-page-for="${id}"]`);
          if (cell) cell.textContent = String(number);
        }
      }, pages);
      buffer = await page.pdf(pdfOptions);
      const texts = await pageTexts(buffer);
      const next = locateChapters(texts, entries);
      const stable = entries.every(({ id }) => next[id] === pages[id]);
      pages = next;
      if (stable) {
        await writeFile(pdfPath, buffer);
        console.info(
          `Wrote ${path.relative(process.cwd(), pdfPath)}: ${texts.length} pages, ${buffer.length} bytes`,
        );
        console.info(entries.map(({ id }) => `${id}=${pages[id]}`).join(' '));
        return;
      }
    }
    throw new Error('Table of contents page numbers did not stabilise');
  } finally {
    await browser.close();
  }
};

await main();
