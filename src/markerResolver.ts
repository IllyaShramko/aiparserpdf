import { distance } from "fastest-levenshtein";
import { ResolvedLesson } from "./types";
import { ModuleWithOrigin } from "./moduleSplitter";

const MIN_ACCEPTABLE_SCORE = 0.7; // ниже этого — считаем маркер не найденным

// ИЗВЕСТНОЕ ОГРАНИЧЕНИЕ: посимвольный Levenshtein хорошо переживает лёгкие опечатки
// и изменения пробелов/пунктуации, но плохо переживает ПЕРЕСТАНОВКУ СЛОВ внутри маркера
// (например модель вернула "наступил конец главы первой" вместо дословного "конец первой главы" —
// смысл тот же, но score упадёт ниже порога). Если в реальных прогонах это окажется частым
// поведением моделей — есть смысл добавить word-level сравнение (например Jaccard по токенам)
// как fallback перед тем, как помечать маркер unresolved.

/**
 * Скользящее окно по исходному тексту: ищем подстроку длиной ~= длине marker,
 * которая ближе всего к marker по нормализованному Levenshtein.
 * Это дороже, чем indexOf, но переживает случаи, когда модель:
 *  - слегка меняет пробелы/пунктуацию,
 *  - чуть обрезает или добавляет слово на границе,
 *  - переносит регистр первой буквы (начало предложения после normalize).
 */
function fuzzyFind(
  haystack: string,
  needle: string
): { index: number; score: number } {
  const normalizedNeedle = needle.trim().toLowerCase();
  if (normalizedNeedle.length === 0) return { index: -1, score: 0 };

  const windowSize = normalizedNeedle.length;
  const step = Math.max(1, Math.floor(windowSize / 4)); // грубый шаг для скорости на длинных документах
  const lowerHaystack = haystack.toLowerCase();

  let bestScore = -Infinity;
  let bestIndex = -1;

  for (let i = 0; i <= lowerHaystack.length - windowSize; i += step) {
    const window = lowerHaystack.slice(i, i + windowSize);
    const d = distance(window, normalizedNeedle);
    const score = 1 - d / Math.max(window.length, normalizedNeedle.length);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  // Локальное уточнение вокруg лучшего окна (шаг = 1) для точной позиции
  if (bestIndex >= 0) {
    const refineStart = Math.max(0, bestIndex - step);
    const refineEnd = Math.min(
      lowerHaystack.length - windowSize,
      bestIndex + step
    );
    for (let i = refineStart; i <= refineEnd; i++) {
      const window = lowerHaystack.slice(i, i + windowSize);
      const d = distance(window, normalizedNeedle);
      const score = 1 - d / Math.max(window.length, normalizedNeedle.length);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
  }

  return { index: bestIndex, score: Math.max(0, bestScore) };
}

/**
 * Резолвит все уроки из ответа Промпта 1 в реальные диапазоны исходного текста.
 * Уроки с title === "SKIP_PRACTICAL" резолвятся тоже (для метрик), но помечаются отдельно —
 * решение об исключении из финального результата принимается на уровне вызывающего кода.
 */
export function resolveLessons(
  sourceText: string,
  modules: ModuleWithOrigin[]
): ResolvedLesson[] {
  const resolved: ResolvedLesson[] = [];

  for (const mod of modules) {
    for (const lesson of mod.lessons) {
      const startMatch = fuzzyFind(sourceText, lesson.start_marker);
      const endMatchRaw = fuzzyFind(sourceText, lesson.end_marker);

      // Конец урока — это конец найденного end_marker, а не начало
      const endIndex =
        endMatchRaw.index >= 0
          ? endMatchRaw.index + lesson.end_marker.trim().length
          : -1;

      const resolvedOk =
        startMatch.score >= MIN_ACCEPTABLE_SCORE &&
        endMatchRaw.score >= MIN_ACCEPTABLE_SCORE &&
        startMatch.index >= 0 &&
        endIndex > startMatch.index;

      resolved.push({
        moduleTitle: mod.title,
        originalModuleTitle: mod.originalTitle,
        moduleIndex: 0, // проставляется позже через assignIndices
        lessonIndex: 0,
        lessonTitle: lesson.title,
        rawText: resolvedOk
          ? sourceText.slice(startMatch.index, endIndex)
          : "",
        startMatchScore: startMatch.score,
        endMatchScore: endMatchRaw.score,
        resolvedOk,
        startIndex: startMatch.index,
        endIndex,
      });
    }
  }

  return resolved;
}
