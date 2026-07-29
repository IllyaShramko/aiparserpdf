import { Module, ResolvedLesson } from "./types";

// Порог, после которого модуль считается "перегруженным" и режется на части.
// 15+ уроков в одном модуле — по твоему указанию.
export const MAX_LESSONS_PER_MODULE = 15;

export interface SplitReport {
  overloadedModulesSplit: number;
  modulesAfterSplitCount: number;
}

// Модуль после пост-обработки — хранит исходный заголовок отдельно от финального,
// чтобы в отчётах было видно "это часть модуля X", а не потерянная информация.
export interface ModuleWithOrigin extends Module {
  originalTitle: string;
}

/**
 * Если модуль вернул больше MAX_LESSONS_PER_MODULE уроков — режем его на части
 * по MAX_LESSONS_PER_MODULE уроков каждая: "Тема (часть 1)", "Тема (часть 2)", ...
 * Заголовок модуля сохраняется как основа, чтобы не терять смысловую связь между частями —
 * это НЕ новые независимые темы, а технический предел на объём одного модуля.
 *
 * Работает на уровне Module[] (результат Step1), ДО резолва маркеров — так проще
 * и дешевле, чем резать уже резолвленные уроки.
 */
export function splitOverloadedModules(modules: Module[]): {
  modules: ModuleWithOrigin[];
  report: SplitReport;
} {
  const result: ModuleWithOrigin[] = [];
  let overloadedModulesSplit = 0;

  for (const mod of modules) {
    if (mod.lessons.length <= MAX_LESSONS_PER_MODULE) {
      result.push({ ...mod, originalTitle: mod.title });
      continue;
    }

    overloadedModulesSplit++;
    const chunksCount = Math.ceil(mod.lessons.length / MAX_LESSONS_PER_MODULE);
    for (let i = 0; i < chunksCount; i++) {
      const chunkLessons = mod.lessons.slice(
        i * MAX_LESSONS_PER_MODULE,
        (i + 1) * MAX_LESSONS_PER_MODULE
      );
      result.push({
        title: `${mod.title} (часть ${i + 1})`,
        originalTitle: mod.title,
        lessons: chunkLessons,
      });
    }
  }

  return {
    modules: result,
    report: {
      overloadedModulesSplit,
      modulesAfterSplitCount: result.length,
    },
  };
}

/**
 * Проставляет moduleIndex/lessonIndex по порядку — нужно для построения путей папок
 * (01-название-модуля/01-название-урока.md) и для стабильной сортировки в отчётах.
 */
export function assignIndices(resolved: ResolvedLesson[]): ResolvedLesson[] {
  const moduleOrder: string[] = [];
  for (const r of resolved) {
    if (!moduleOrder.includes(r.moduleTitle)) moduleOrder.push(r.moduleTitle);
  }

  const lessonCounters = new Map<string, number>();

  return resolved.map((r) => {
    const moduleIndex = moduleOrder.indexOf(r.moduleTitle) + 1;
    const nextLessonIndex = (lessonCounters.get(r.moduleTitle) ?? 0) + 1;
    lessonCounters.set(r.moduleTitle, nextLessonIndex);

    return {
      ...r,
      moduleIndex,
      lessonIndex: nextLessonIndex,
    };
  });
}
