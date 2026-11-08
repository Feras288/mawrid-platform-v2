import { AppError } from "@platform/core";

/**
 * Local OCR fallback (Tesseract, Arabic + English) for scanned BOQ images. Enabled only when
 * OCR_LANG_PATH points to a directory containing ara.traineddata and eng.traineddata — the platform
 * never downloads language data at runtime. Accuracy on Arabic tables is limited (documented).
 */
export interface OcrResult {
  text: string;
  confidence: number; // 0..100
  words: { text: string; x0: number; y0: number; x1: number; y1: number }[];
}

export interface OcrEngine {
  isConfigured(): boolean;
  recognize(image: Buffer): Promise<OcrResult>;
}

class TesseractEngine implements OcrEngine {
  constructor(private langPath: string | undefined) {}
  isConfigured() {
    return Boolean(this.langPath);
  }
  async recognize(image: Buffer): Promise<OcrResult> {
    if (!this.langPath) throw new AppError("INTEGRATION_UNAVAILABLE", "OCR is not configured", { key: "ocr_not_configured" });
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker(["ara", "eng"], 1, { langPath: this.langPath, gzip: false, cacheMethod: "none" });
    try {
      const res = await worker.recognize(image, {}, { blocks: true });
      const words: OcrResult["words"] = [];
      for (const b of res.data.blocks ?? [])
        for (const p of b.paragraphs)
          for (const l of p.lines) for (const w of l.words) words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
      return { text: res.data.text, confidence: res.data.confidence, words };
    } finally {
      await worker.terminate();
    }
  }
}

let override: OcrEngine | undefined;
export function getOcr(): OcrEngine {
  return override ?? new TesseractEngine(process.env.OCR_LANG_PATH || undefined);
}
export function setOcr(e: OcrEngine | undefined) {
  override = e;
}
