import * as fs from "fs";
import * as path from "path";
import { callModel } from "./lmStudioClient";
import { extractStructuralSplit } from "./jsonExtract";
import { resolveLessons } from "./markerResolver";
import { splitOverloadedModules, assignIndices } from "./moduleSplitter";
import { ModelConfig, RunMetrics, LessonConspect } from "./types";

const STEP1_PROMPT = fs.readFileSync(
  path.join(__dirname, "..", "prompts", "step1-structural-split.md"),
  "utf-8"
);
const STEP2_PROMPT = fs.readFileSync(
  path.join(__dirname, "..", "prompts", "step2-conspect.md"),
  "utf-8"
);

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Полный прогон пайплайна на одном документе с ЗАКРЕПЛЁННОЙ парой моделей:
 * step1Model делает структурный сплит (нужно понимать документ целиком и держать JSON),
 * step2Model делает конспект/лёгкую перефразировку уже нарезанного урока (задача локальная,
 * можно взять модель попроще и подешевле по ресурсам).
 * Возвращает подробные метрики — специально не "падает" на частичных ошибках,
 * а фиксирует их в errors[].
 */
export async function runPipeline(
  step1Model: ModelConfig,
  step2Model: ModelConfig,
  documentName: string,
  sourceText: string
): Promise<RunMetrics> {
  const errors: string[] = [];

  // --- Шаг 1: структурный сплит (модель step1Model) ---
  const step1Start = Date.now();
  let step1RawResponse = "";
  let step1ParsedOk = false;
  let modulesCount = 0; // модулей ДО пост-обработки — сколько реально вернула модель
  let lessonsCount = 0;
  let skippedPracticalCount = 0;
  let modulesAfterSplitCount = 0;
  let overloadedModulesSplit = 0;
  let resolved: ReturnType<typeof resolveLessons> = [];

  try {
    const step1Result = await callModel(step1Model, STEP1_PROMPT, sourceText);
    step1RawResponse = step1Result.content;

    const { parsed, error } = extractStructuralSplit(step1Result.content);
    if (error || !parsed) {
      errors.push(`[Step1] Парсинг JSON не удался: ${error}`);
    } else {
      step1ParsedOk = true;
      modulesCount = parsed.modules.length;
      for (const m of parsed.modules) {
        lessonsCount += m.lessons.length;
        skippedPracticalCount += m.lessons.filter(
          (l) => l.title === "SKIP_PRACTICAL"
        ).length;
      }

      // Пост-обработка: если модель свалила 15+ уроков в один модуль — режем на части
      // "Тема (часть 1)", "Тема (часть 2)", ... — это техническое ограничение на объём
      // модуля, а не решение модели, поэтому делаем это ПОСЛЕ парсинга её ответа.
      const { modules: modulesForResolve, report } = splitOverloadedModules(
        parsed.modules
      );
      modulesAfterSplitCount = report.modulesAfterSplitCount;
      overloadedModulesSplit = report.overloadedModulesSplit;

      resolved = assignIndices(resolveLessons(sourceText, modulesForResolve));
    }
  } catch (e) {
    errors.push(`[Step1] Вызов модели упал: ${(e as Error).message}`);
  }
  const step1DurationMs = Date.now() - step1Start;

  const lessonsResolved = resolved.filter((r) => r.resolvedOk).length;
  const lessonsUnresolved = resolved.length - lessonsResolved;
  const avgMarkerMatchScore =
    resolved.length > 0
      ? resolved.reduce(
          (sum, r) => sum + (r.startMatchScore + r.endMatchScore) / 2,
          0
        ) / resolved.length
      : 0;

  // --- Шаг 2: конспект по каждому успешно резолвленному, не-практическому уроку (модель step2Model) ---
  const step2Results: LessonConspect[] = [];
  const step2Start = Date.now();

  const lessonsToConspect = resolved.filter(
    (r) => r.resolvedOk && r.lessonTitle !== "SKIP_PRACTICAL"
  );

  for (const lesson of lessonsToConspect) {
    try {
      const result = await callModel(step2Model, STEP2_PROMPT, lesson.rawText);
      const wordCountResult = countWords(result.content);
      step2Results.push({
        moduleTitle: lesson.moduleTitle,
        moduleIndex: lesson.moduleIndex,
        lessonIndex: lesson.lessonIndex,
        lessonTitle: lesson.lessonTitle,
        wordCountSource: countWords(lesson.rawText),
        wordCountResult,
        conspect: result.content,
        withinWordRange: wordCountResult >= 450 && wordCountResult <= 850, // небольшой допуск к 500-800
      });
    } catch (e) {
      errors.push(
        `[Step2] Урок "${lesson.lessonTitle}" — вызов модели упал: ${(e as Error).message}`
      );
    }
  }
  const step2TotalDurationMs = Date.now() - step2Start;

  return {
    step1ModelId: step1Model.id,
    step2ModelId: step2Model.id,
    documentName,
    timestampIso: new Date().toISOString(),

    step1DurationMs,
    step1RawResponse,
    step1ParsedOk,
    step1ModulesCount: modulesCount,
    step1LessonsCount: lessonsCount,
    step1SkippedPracticalCount: skippedPracticalCount,
    modulesAfterSplitCount,
    overloadedModulesSplit,

    lessonsResolved,
    lessonsUnresolved,
    avgMarkerMatchScore,

    step2Results,
    step2TotalDurationMs,
    step2AvgDurationPerLessonMs:
      step2Results.length > 0 ? step2TotalDurationMs / step2Results.length : 0,

    errors,
  };
}
