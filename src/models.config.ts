import * as dotenv from "dotenv";
dotenv.config();
import { ModelConfig } from "./types";

export const API_PROVIDER = (
  process.env.API_PROVIDER || (process.env.OPENROUTER_API_KEY ? "openrouter" : "lmstudio")
).toLowerCase();

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";

export const API_BASE_URL =
  API_PROVIDER === "openrouter"
    ? "https://openrouter.ai/api/v1"
    : (process.env.LM_STUDIO_BASE_URL || "http://localhost:1234/v1");

// Экспорт для совместимости
export const LM_STUDIO_BASE_URL = API_BASE_URL;

// --- Vision модель (для OCR / распознавания PDF страниц) ---
export const PARSER_VISION_MODEL: ModelConfig = {
  id: API_PROVIDER === "openrouter" ? "nemotron-vl-free" : "qwen2.5-vl-7b",
  modelName:
    process.env.VISION_MODEL ||
    (API_PROVIDER === "openrouter"
      ? "nvidia/nemotron-nano-12b-v2-vl:free"
      : "qwen2.5-vl-7b-instruct"),
  temperature: 0.0,
  maxTokens: 8192,
};

// --- Step 1 (структурный сплит на модули/уроки) ---
export const STEP1_MODEL: ModelConfig = {
  id: API_PROVIDER === "openrouter" ? "nemotron-120b-free" : "gemma-4-e4b",
  modelName:
    process.env.STEP1_MODEL ||
    (API_PROVIDER === "openrouter"
      ? "nvidia/nemotron-3-super-120b-a12b:free"
      : "google/gemma-4-e4b"),
  temperature: 0.2,
  maxTokens: 4096,
};

// --- Step 2 (конспектирование уроков) ---
export const STEP2_MODEL: ModelConfig = {
  id: API_PROVIDER === "openrouter" ? "nemotron-120b-free" : "qwen3-1.7b",
  modelName:
    process.env.STEP2_MODEL ||
    (API_PROVIDER === "openrouter"
      ? "nvidia/nemotron-3-super-120b-a12b:free"
      : "qwen/qwen3-1.7b"),
  temperature: 0.2,
  maxTokens: 4096,
};

// Популярные бесплатные модели на OpenRouter (для справки):
export const OPENROUTER_FREE_MODELS = [
  "google/gemini-2.0-flash-exp:free",
  "google/gemini-2.0-pro-exp-02-05:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "meta-llama/llama-3.2-11b-vision-instruct:free",
  "qwen/qwen-2.5-vl-72b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "deepseek/deepseek-r1:free",
];
