import * as fs from "fs";
import { PDFParse } from "pdf-parse";

/**
 * pdf-parse v2 (не v1!) использует класс PDFParse вместо функции pdf(buffer).
 * Важно вызывать parser.destroy() — иначе воркеры pdfjs-dist остаются висеть в памяти
 * при многократных прогонах (актуально, когда гоняешь несколько документов подряд в одном процессе).
 */
export async function extractTextFromPdf(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
