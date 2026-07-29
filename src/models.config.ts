import { ModelConfig } from "./types";

// LM Studio по умолчанию поднимает OpenAI-совместимый сервер на localhost:1234
// Проверь порт в LM Studio -> Developer -> Server Settings, если у тебя другой
export const LM_STUDIO_BASE_URL = "http://localhost:1234/v1";

// Важно: modelName должен ТОЧНО совпадать со строкой модели, которую LM Studio
// показывает в консоли сервера при загрузке (не обязательно совпадает с названием на скрине).
// Проще всего: запусти модель в LM Studio, глянь консоль сервера -> там будет "model": "..."
// либо просто дергани GET {LM_STUDIO_BASE_URL}/models и возьми id оттуда.

// --- Пара моделей для пайплайна, зашита жёстко (по договорённости) ---
// Step1 (структурный сплит на модули/уроки) — модель посильнее, ей нужно
// понимать структуру всего документа и держать сложный формат ответа (JSON).
export const STEP1_MODEL: ModelConfig = {
  id: "gemma-4-e4b",
  modelName: "google/gemma-4-e4b", // ПРОВЕРЬ реальный id через /v1/models
  temperature: 0.2,
  maxTokens: 4096,
};

// Step2 (лёгкая перефразировка/конспект уже нарезанного урока) — модель попроще,
// задача локальная и не требует держать в голове весь документ целиком.
export const STEP2_MODEL: ModelConfig = {
  id: "qwen3-1.7b",
  modelName: "qwen/qwen3-1.7b", // ПРОВЕРЬ реальный id через /v1/models
  temperature: 0.2,
  maxTokens: 4096,
};

// --- Другие модели, доступные в LM Studio (на будущее, если решишь сравнить другую пару) ---
// Сейчас НЕ используются в пайплайне — оставлены для справки/ручных экспериментов.
export const OTHER_AVAILABLE_MODELS: ModelConfig[] = [
  {
    id: "gemma-2-9b",
    modelName: "google/gemma-2-9b",
    temperature: 0.2,
    maxTokens: 4096,
  },
  {
    id: "qwen2.5-7b-instruct",
    modelName: "lmstudio-community/qwen2.5-7b-instruct",
    temperature: 0.2,
    maxTokens: 4096,
  },
  {
    id: "llama-3.1-8b-instruct",
    modelName: "bartowski/meta-llama-3.1-8b-instruct",
    temperature: 0.2,
    maxTokens: 4096,
  },
];
