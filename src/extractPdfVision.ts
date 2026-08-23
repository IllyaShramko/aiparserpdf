import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { callVisionModel } from "./lmStudioClient";
import { PARSER_VISION_MODEL } from "./models.config";

const execFileAsync = promisify(execFile);
const OUTPUT_DIR = path.join(__dirname, "..", "output");
const PYTHON_RENDER_SCRIPT = path.join(__dirname, "renderPdf.py");

export interface VisionExtractOptions {
  forceReExtract?: boolean;
  dpi?: number;
  visionPrompt?: string;
  modelConfig?: import("./types").ModelConfig;
}

// Оптимальный промпт для Qwen2.5-VL: структурирует заголовки, таблицы, LaTeX формулы и убирает мусорные колонтитулы
const DEFAULT_VISION_PROMPT =
  "Transcribe the complete content of this document page into clean Markdown.\n" +
  "- Preserve document hierarchy using Markdown headings (# for title/H1, ## for main sections/H2, ### for subsections/H3).\n" +
  "- Convert all tables into standard Markdown tables.\n" +
  "- Format mathematical formulas, equations, and variables in standard LaTeX format ($...$ for inline, $$...$$ for standalone block formulas).\n" +
  "- Filter out repetitive running headers, running footers, and standalone page numbers.\n" +
  "- Reconnect Russian words broken by hyphenated line wraps (e.g. 'моделиро- вание' -> 'моделирование').\n" +
  "- Output ONLY the clean Markdown content without conversational preamble, commentary, or ```markdown code blocks.";

interface RenderResult {
  pageCount: number;
  files: string[];
}

/**
 * Рендерит страницы PDF в PNG через PyMuPDF (быстро и без багов со шрифтами Type3).
 */
async function renderPdfPages(
  pdfPath: string,
  outputDir: string,
  dpi = 150
): Promise<RenderResult> {
  const { stdout, stderr } = await execFileAsync("python", [
    PYTHON_RENDER_SCRIPT,
    pdfPath,
    outputDir,
    dpi.toString(),
  ]);

  if (stderr && stderr.includes("Error")) {
    throw new Error(`Ошибка рендеринга PDF: ${stderr}`);
  }

  // Находим последнюю JSON-строку в stdout
  const lines = stdout.trim().split("\n");
  const jsonLine = lines[lines.length - 1];
  return JSON.parse(jsonLine) as RenderResult;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Извлекает структурированный Markdown из PDF с помощью Vision-модели (Qwen2.5-VL / VLM в LM Studio).
 * Поддерживает чекпоинты (per-page caching) и автоматический retry при сбоях.
 */
export async function extractMarkdownWithVision(
  pdfPath: string,
  documentName: string,
  options: VisionExtractOptions = {}
): Promise<{ markdown: string; fromCache: boolean; pageCount: number; durationMs: number }> {
  const modelToUse = options.modelConfig ?? PARSER_VISION_MODEL;
  const docBaseName = documentName.replace(/\.pdf$/i, "");
  const docOutputDir = path.join(OUTPUT_DIR, docBaseName);
  const cacheFilePath = path.join(docOutputDir, "extracted_vision.md");
  const tempPagesDir = path.join(docOutputDir, ".temp_pages");

  if (!fs.existsSync(docOutputDir)) {
    fs.mkdirSync(docOutputDir, { recursive: true });
  }

  // Полный кэш всего документа
  if (!options.forceReExtract && fs.existsSync(cacheFilePath)) {
    const cachedMarkdown = fs.readFileSync(cacheFilePath, "utf-8");
    console.log(`[Vision OCR] Загружен кэшированный результат из: ${cacheFilePath}`);
    return {
      markdown: cachedMarkdown,
      fromCache: true,
      pageCount: 0,
      durationMs: 0,
    };
  }

  console.log(`[Vision OCR] Рендеринг страниц PDF: ${pdfPath}...`);
  const start = Date.now();
  const { pageCount, files } = await renderPdfPages(pdfPath, tempPagesDir, options.dpi ?? 150);

  console.log(
    `[Vision OCR] Успешно отрендерено ${pageCount} страниц. Начинаю OCR через ${modelToUse.modelName}...`
  );

  const pageMarkdowns: string[] = [];
  const visionPrompt = options.visionPrompt ?? DEFAULT_VISION_PROMPT;

  for (let i = 0; i < files.length; i++) {
    const pageNum = i + 1;
    const pageFilePath = files[i];
    const pageMdPath = pageFilePath.replace(/\.png$/i, ".md");

    // Чекпоинт: если страница уже была успешно распознана ранее — читаем с диска
    if (!options.forceReExtract && fs.existsSync(pageMdPath)) {
      const existingContent = fs.readFileSync(pageMdPath, "utf-8");
      if (existingContent.trim().length > 0) {
        console.log(
          `[Vision OCR] Страница ${pageNum}/${pageCount} загружена из локального чекпоинта (~${
            existingContent.trim().split(/\s+/).length
          } слов)`
        );
        pageMarkdowns.push(existingContent.trim());
        continue;
      }
    }

    const pageBase64 = fs.readFileSync(pageFilePath).toString("base64");
    console.log(`[Vision OCR] Обработка страницы ${pageNum}/${pageCount}...`);

    let pageContent = "";
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const pageStart = Date.now();
        const result = await callVisionModel(modelToUse, visionPrompt, pageBase64);
        const pageElapsed = ((Date.now() - pageStart) / 1000).toFixed(1);
        pageContent = result.content.trim();

        console.log(
          `  └─ Страница ${pageNum} готова за ${pageElapsed}s (~${
            pageContent.split(/\s+/).length
          } слов)`
        );
        // Сохраняем чекпоинт страницы
        fs.writeFileSync(pageMdPath, pageContent, "utf-8");
        break;
      } catch (err) {
        console.warn(
          `  [Внимание] Попытка ${attempts}/${maxAttempts} для страницы ${pageNum} не удалась: ${
            (err as Error).message
          }`
        );
        if (attempts < maxAttempts) {
          console.log(`  └─ Повтор через 5 секунд...`);
          await delay(5000);
        } else {
          throw err;
        }
      }
    }

    pageMarkdowns.push(pageContent);
  }

  const fullMarkdown = pageMarkdowns.join("\n\n<!-- PAGE_BREAK -->\n\n");
  const totalDurationMs = Date.now() - start;

  // Сохраняем полный финальный Markdown
  fs.writeFileSync(cacheFilePath, fullMarkdown, "utf-8");
  console.log(
    `[Vision OCR] Распознавание завершено за ${(totalDurationMs / 1000).toFixed(
      1
    )}s. Сохранено в: ${cacheFilePath}`
  );

  return {
    markdown: fullMarkdown,
    fromCache: false,
    pageCount,
    durationMs: totalDurationMs,
  };
}
