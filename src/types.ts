// Конфигурация одной модели, которую тестируем через LM Studio
export interface ModelConfig {
  id: string;              // человекочитаемый id для отчётов, напр. "gemma-4-e4b"
  modelName: string;       // строка модели, которую LM Studio ожидает в поле "model" запроса
  temperature?: number;
  maxTokens?: number;
}

// Результат Промпта 1 (структурный сплит)
export interface StructuralSplit {
  modules: Module[];
}

export interface Module {
  title: string;
  lessons: LessonMarker[];
}

export interface LessonMarker {
  title: string;
  start_marker: string;
  end_marker: string;
}

// Урок после резолва маркеров в реальные позиции текста
export interface ResolvedLesson {
  moduleTitle: string;       // финальный заголовок модуля (может быть "Тема (часть 2)" после сплита)
  originalModuleTitle: string; // заголовок модуля, который вернула модель, до пост-обработки
  moduleIndex: number;       // индекс финального модуля (после возможного разбиения), с 1
  lessonIndex: number;       // индекс урока внутри финального модуля, с 1
  lessonTitle: string;
  rawText: string;          // дословный кусок исходного текста
  startMatchScore: number;  // 0..1, качество fuzzy-совпадения start_marker
  endMatchScore: number;
  resolvedOk: boolean;      // true если оба маркера нашлись с приемлемым качеством
  startIndex: number;
  endIndex: number;
}

// Итог по одному уроку после Промпта 2 (конспект)
export interface LessonConspect {
  moduleTitle: string;
  moduleIndex: number;
  lessonIndex: number;
  lessonTitle: string;
  wordCountSource: number;
  wordCountResult: number;
  conspect: string;
  withinWordRange: boolean; // 500-800 слов на блок, как того требует систем-промпт
}

// Метрики одного полного прогона (пара моделей Step1/Step2, один документ)
export interface RunMetrics {
  step1ModelId: string;
  step2ModelId: string;
  documentName: string;
  timestampIso: string;

  step1DurationMs: number;
  step1RawResponse: string;
  step1ParsedOk: boolean;
  step1ModulesCount: number;        // сколько модулей вернула модель ДО пост-обработки
  step1LessonsCount: number;
  step1SkippedPracticalCount: number;
  modulesAfterSplitCount: number;   // сколько модулей ПОСЛЕ авто-разбиения перегруженных
  overloadedModulesSplit: number;   // сколько исходных модулей пришлось разбить (были перегружены уроками)

  lessonsResolved: number;
  lessonsUnresolved: number;
  avgMarkerMatchScore: number;

  step2Results: LessonConspect[];
  step2TotalDurationMs: number;
  step2AvgDurationPerLessonMs: number;

  errors: string[];
}
