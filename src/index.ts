import * as fs from "fs";
import * as path from "path";
import { extractTextFromPdf } from "./extractPdf";
import { extractMarkdownWithVision } from "./extractPdfVision";
import { runPipeline } from "./runner";
import {
  STEP1_MODEL,
  STEP2_MODEL,
  PARSER_VISION_MODEL,
  API_PROVIDER,
  OPENROUTER_API_KEY,
} from "./models.config";
import { listAvailableModels } from "./lmStudioClient";
import { RunMetrics } from "./types";

const OUTPUT_DIR = path.join(__dirname, "..", "output");
const INPUT_DIR = path.join(__dirname, "..", "input");

/**
 * ===========================================================================
 * КАК ЗАПУСТИТЬ (пошагово)
 * ===========================================================================
 * 1. npm install                                     — один раз, ставит зависимости
 * 2. Открой LM Studio -> Developer -> Start Server    — поднимет сервер на localhost:1234
 * 3. Положи PDF-файл в папку /input
 * 4. Запусти:
 *      npm run run -- имя-файла.pdf            (быстрый pdf-parse)
 *      npm run run -- имя-файла.pdf --vision   (структурный OCR через MinerU/VLM)
 *      npm run run -- имя-файла.pdf --vision --force (принудительный перезапуск OCR без кэша)
 * ===========================================================================
 */
async function main() {
  const args = process.argv.slice(2);
  const useVision = args.includes("--vision") || args.includes("--mineru");
  const forceReExtract = args.includes("--force");
  const fileArg = args.find((a) => !a.startsWith("--"));

  if (!fileArg) {
    console.error("Укажи файл: npm run run -- <файл.pdf> [--vision] [--force]");
    console.error(`Файлы должны лежать в ${INPUT_DIR}`);
    process.exit(1);
  }

  const filePath = path.join(INPUT_DIR, fileArg);
  if (!fs.existsSync(filePath)) {
    console.error(`Файл не найден: ${filePath}`);
    process.exit(1);
  }

  let visionModel = { ...PARSER_VISION_MODEL };
  let step1Model = { ...STEP1_MODEL };
  let step2Model = { ...STEP2_MODEL };

  if (API_PROVIDER === "openrouter") {
    if (!OPENROUTER_API_KEY) {
      console.error(
        "ОШИБКА: Выбран провайдер OpenRouter, но переменная OPENROUTER_API_KEY не задана!\n" +
          "Создай файл .env в корне проекта и добавь туда свой ключ:\n" +
          "OPENROUTER_API_KEY=sk-or-v1-...\n"
      );
      process.exit(1);
    }
    console.log(`=== Режим: OpenRouter Cloud ===`);
    console.log(`  Vision OCR : ${visionModel.modelName}`);
    console.log(`  Step 1     : ${step1Model.modelName}`);
    console.log(`  Step 2     : ${step2Model.modelName}\n`);
  } else {
    // Сверка с реальным списком моделей в LM Studio
    try {
      const available = await listAvailableModels();
      console.log("Модели, реально доступные в LM Studio прямо сейчас:");
      available.forEach((m) => console.log(`  - ${m}`));
      console.log("");

      if (useVision && !available.includes(visionModel.modelName)) {
        const match = available.find((m) => /vl|vision|qwen.*vl|minicpm/i.test(m));
        if (match) {
          console.log(`[Vision OCR] Автоматически подключена загруженная Vision-модель: "${match}"\n`);
          visionModel.modelName = match;
        } else {
          console.warn(
            `ВНИМАНИЕ: Vision-модель ("${visionModel.modelName}") не найдена в списке выше. ` +
              `Убедись, что Qwen2.5-VL загружена в LM Studio.`
          );
        }
      }

      if (!available.includes(step1Model.modelName)) {
        const match = available.find((m) => m.includes(step1Model.id) || m.endsWith(step1Model.id));
        if (match) step1Model.modelName = match;
      }

      if (!available.includes(step2Model.modelName)) {
        const match = available.find((m) => m.includes(step2Model.id) || m.endsWith(step2Model.id));
        if (match) step2Model.modelName = match;
      }
      console.log("");
    } catch (e) {
      console.error(
        `Не удалось достучаться до LM Studio (${(e as Error).message}). ` +
          `Проверь, что сервер запущен: LM Studio -> Developer -> Start Server.`
      );
      process.exit(1);
    }
  }

  let sourceText = "";
  if (useVision) {
    console.log(`[Парсер] Используется Vision OCR (${visionModel.modelName})...`);
    const visionRes = await extractMarkdownWithVision(filePath, fileArg, {
      forceReExtract,
      modelConfig: visionModel,
    });
    sourceText = visionRes.markdown;
  } else {
    console.log(`[Парсер] Извлекаю текст из ${fileArg} (pdf-parse)...`);
    sourceText = await extractTextFromPdf(filePath);
  }

  console.log(
    `Текст подготовлен: ${sourceText.length} символов, ~${
      sourceText.trim().split(/\s+/).length
    } слов\n`
  );

  console.log(
    `=== Прогон: Step1=${step1Model.id} (структурный сплит) | Step2=${step2Model.id} (конспект) ===`
  );
  const metrics = await runPipeline(step1Model, step2Model, fileArg, sourceText);

  console.log(
    `  Step1: ${metrics.step1ParsedOk ? "OK" : "ОШИБКА"} | ` +
      `модулей от модели: ${metrics.step1ModulesCount}, после авто-разбиения: ${metrics.modulesAfterSplitCount} ` +
      `(разбито из-за перегрузки: ${metrics.overloadedModulesSplit}), уроков: ${metrics.step1LessonsCount}, ` +
      `практических (пропущено): ${metrics.step1SkippedPracticalCount} | ` +
      `${metrics.step1DurationMs}ms`
  );
  console.log(
    `  Markers: резолвлено ${metrics.lessonsResolved}/${
      metrics.lessonsResolved + metrics.lessonsUnresolved
    }, средний fuzzy score: ${metrics.avgMarkerMatchScore.toFixed(3)}`
  );
  console.log(
    `  Step2: ${metrics.step2Results.length} конспектов сгенерировано, ` +
      `среднее время/урок: ${metrics.step2AvgDurationPerLessonMs.toFixed(0)}ms`
  );
  if (metrics.errors.length > 0) {
    console.log(`  Ошибки:`);
    metrics.errors.forEach((e) => console.log(`    - ${e}`));
  }
  console.log("");

  saveModelReport(fileArg, metrics);
  appendToComparisonSummary(fileArg, metrics);
  console.log(`Готово. Отчёты сохранены в ${OUTPUT_DIR}`);
}

/**
 * Превращает произвольный заголовок в безопасное имя файла/папки:
 * убирает символы, которые ломают файловую систему, режет длину, убирает пробелы по краям.
 * Кириллица сохраняется — она валидна в именах файлов на всех современных ФС.
 */
function toSafeSlug(title: string, maxLength = 60): string {
  return (
    title
      .replace(/[\\/:*?"<>|]/g, "") // запрещённые символы Windows/Unix
      .replace(/\s+/g, "-")
      .trim()
      .slice(0, maxLength)
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

function pairDirName(metrics: RunMetrics): string {
  return `${metrics.step1ModelId}__${metrics.step2ModelId}`;
}

function saveModelReport(documentName: string, metrics: RunMetrics) {
  const baseName = path.basename(documentName, path.extname(documentName));
  const runDir = path.join(OUTPUT_DIR, baseName, pairDirName(metrics));
  fs.mkdirSync(runDir, { recursive: true });

  // Полный JSON с метриками
  fs.writeFileSync(
    path.join(runDir, "metrics.json"),
    JSON.stringify(metrics, null, 2),
    "utf-8"
  );

  // Сырой ответ шага 1 отдельно — часто нужно смотреть глазами, что модель реально вернула
  fs.writeFileSync(
    path.join(runDir, "step1-raw-response.txt"),
    metrics.step1RawResponse,
    "utf-8"
  );

  // Собранный markdown-результат целиком — то, что реально пойдёт в продукт одним файлом
  const combinedMarkdown = metrics.step2Results
    .map((r) => r.conspect)
    .join("\n\n---\n\n");
  fs.writeFileSync(
    path.join(runDir, "combined-conspect.md"),
    combinedMarkdown,
    "utf-8"
  );

  // --- Структура папок по модулям ---
  // lessons/
  //   01-Название-модуля/
  //     _module.md
  //     01-Название-урока.md
  //     02-Название-урока.md
  //   02-Название-модуля-(часть-2)/   <- если модуль был авто-разбит из-за перегрузки уроками
  //     ...
  const lessonsRoot = path.join(runDir, "lessons");
  fs.mkdirSync(lessonsRoot, { recursive: true });

  for (const lesson of metrics.step2Results) {
    const moduleFolderName = `${String(lesson.moduleIndex).padStart(2, "0")}-${toSafeSlug(
      lesson.moduleTitle,
      50
    )}`;
    const moduleDir = path.join(lessonsRoot, moduleFolderName);
    fs.mkdirSync(moduleDir, { recursive: true });

    const lessonFileName = `${String(lesson.lessonIndex).padStart(2, "0")}-${toSafeSlug(
      lesson.lessonTitle,
      50
    )}.md`;

    const meta =
      `<!-- module: ${lesson.moduleTitle} | words source: ${lesson.wordCountSource} | ` +
      `words result: ${lesson.wordCountResult} | in range 500-800: ${lesson.withinWordRange} -->\n\n`;

    fs.writeFileSync(path.join(moduleDir, lessonFileName), meta + lesson.conspect, "utf-8");
  }

  // Один _module.md на папку модуля — короткий индекс уроков внутри
  const moduleTitles = new Map<number, string>();
  for (const lesson of metrics.step2Results) {
    if (!moduleTitles.has(lesson.moduleIndex)) {
      moduleTitles.set(lesson.moduleIndex, lesson.moduleTitle);
    }
  }
  for (const [moduleIndex, moduleTitle] of moduleTitles) {
    const moduleFolderName = `${String(moduleIndex).padStart(2, "0")}-${toSafeSlug(
      moduleTitle,
      50
    )}`;
    const moduleDir = path.join(lessonsRoot, moduleFolderName);
    const lessonsInModule = metrics.step2Results.filter(
      (l) => l.moduleIndex === moduleIndex
    );
    const indexContent =
      `# ${moduleTitle}\n\n` +
      lessonsInModule
        .map(
          (l) =>
            `- [${l.lessonTitle}](./${String(l.lessonIndex).padStart(2, "0")}-${toSafeSlug(
              l.lessonTitle,
              50
            )}.md) — ${l.wordCountResult} слов`
        )
        .join("\n");
    fs.writeFileSync(path.join(moduleDir, "_module.md"), indexContent, "utf-8");
  }
}

/**
 * Добавляет строку в общую сравнительную таблицу по ВСЕМ прогнанным документам
 * (не по моделям — пара моделей теперь одна и та же на каждый прогон).
 * Полезно, когда гоняешь несколько разных PDF через одну и ту же пару моделей
 * и хочешь увидеть, как объём/тип документа влияет на качество результата.
 */
function appendToComparisonSummary(documentName: string, metrics: RunMetrics) {
  const summaryPath = path.join(OUTPUT_DIR, "_all-runs-summary.json");
  const summaryMdPath = path.join(OUTPUT_DIR, "_all-runs-summary.md");

  let rows: Record<string, unknown>[] = [];
  if (fs.existsSync(summaryPath)) {
    try {
      rows = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    } catch {
      rows = []; // если файл битый — просто начинаем заново, не блокируем прогон
    }
  }

  rows.push({
    document: documentName,
    step1_model: metrics.step1ModelId,
    step2_model: metrics.step2ModelId,
    timestamp: metrics.timestampIso,
    step1_ok: metrics.step1ParsedOk,
    step1_ms: metrics.step1DurationMs,
    modules_from_model: metrics.step1ModulesCount,
    modules_after_split: metrics.modulesAfterSplitCount,
    overloaded_modules_split: metrics.overloadedModulesSplit,
    lessons_found: metrics.step1LessonsCount,
    practical_skipped: metrics.step1SkippedPracticalCount,
    markers_resolved: metrics.lessonsResolved,
    markers_unresolved: metrics.lessonsUnresolved,
    avg_marker_score: Number(metrics.avgMarkerMatchScore.toFixed(3)),
    conspects_generated: metrics.step2Results.length,
    conspects_in_word_range: metrics.step2Results.filter((r) => r.withinWordRange)
      .length,
    avg_step2_ms_per_lesson: Number(metrics.step2AvgDurationPerLessonMs.toFixed(0)),
    errors_count: metrics.errors.length,
  });

  fs.writeFileSync(summaryPath, JSON.stringify(rows, null, 2), "utf-8");

  const header =
    "| Документ | Step1 модель | Step2 модель | Step1 OK | Step1 ms | Модулей (модель) | Модулей (после сплита) | Разбито перегруженных | Уроков | Пропущено практ. | Markers resolved | Avg marker score | Конспектов | В диапазоне слов | Avg ms/урок | Ошибок |\n" +
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
  const body = rows
    .map(
      (r) =>
        `| ${r.document} | ${r.step1_model} | ${r.step2_model} | ${r.step1_ok} | ${r.step1_ms} | ${r.modules_from_model} | ${r.modules_after_split} | ${r.overloaded_modules_split} | ${r.lessons_found} | ${r.practical_skipped} | ${r.markers_resolved}/${(r.markers_resolved as number) + (r.markers_unresolved as number)} | ${r.avg_marker_score} | ${r.conspects_generated} | ${r.conspects_in_word_range}/${r.conspects_generated} | ${r.avg_step2_ms_per_lesson} | ${r.errors_count} |`
    )
    .join("\n");

  fs.writeFileSync(summaryMdPath, header + body, "utf-8");
}

main().catch((e) => {
  console.error("Фатальная ошибка:", e);
  process.exit(1);
});
