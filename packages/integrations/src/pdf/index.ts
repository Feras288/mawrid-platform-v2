import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import QRCode from "qrcode";
import { AppError } from "@platform/core";

/**
 * HTML → PDF with headless Chromium (correct Arabic shaping, bidi and table layout).
 * Fonts are embedded from @fontsource so output does not depend on system fonts.
 */
const require = createRequire(import.meta.url);
let fontCss: string | undefined;

export function embeddedFontCss(): string {
  if (fontCss) return fontCss;
  const dir = join(dirname(require.resolve("@fontsource/ibm-plex-sans-arabic/package.json")), "files");
  const face = (subset: string, weight: number, range: string) =>
    `@font-face{font-family:"Plex Arabic";font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${readFileSync(join(dir, `ibm-plex-sans-arabic-${subset}-${weight}-normal.woff2`)).toString("base64")}) format("woff2");unicode-range:${range};}`;
  const arabic = "U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC";
  const latin = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  fontCss = [face("arabic", 400, arabic), face("arabic", 700, arabic), face("latin", 400, latin), face("latin", 700, latin)].join("\n");
  return fontCss;
}

export async function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, { margin: 1, width: 160, errorCorrectionLevel: "M" });
}

export interface PdfRenderer {
  render(html: string, opts?: { landscape?: boolean }): Promise<Buffer>;
}

class ChromiumRenderer implements PdfRenderer {
  async render(html: string, opts: { landscape?: boolean } = {}): Promise<Buffer> {
    const { chromium } = await import("playwright-core");
    let browser;
    try {
      browser = await chromium.launch({ headless: true, executablePath: process.env.PDF_CHROMIUM_PATH || undefined, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    } catch (e) {
      throw new AppError("INTEGRATION_UNAVAILABLE", "PDF renderer (Chromium) is not available", { key: "pdf_unavailable", cause: e });
    }
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate("document.fonts.ready");
      const pdf = await page.pdf({ format: "A4", landscape: opts.landscape ?? false, printBackground: true, margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" }, displayHeaderFooter: true, headerTemplate: "<span></span>", footerTemplate: '<div style="width:100%;font-size:8px;color:#888;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

let override: PdfRenderer | undefined;
export const getPdfRenderer = (): PdfRenderer => override ?? new ChromiumRenderer();
export const setPdfRenderer = (r: PdfRenderer | undefined) => {
  override = r;
};
