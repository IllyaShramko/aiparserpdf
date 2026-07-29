import { LM_STUDIO_BASE_URL } from "./models.config";
import { ModelConfig } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionResponse {
  choices: {
    message: { content: string };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface CallResult {
  content: string;
  durationMs: number;
  finishReason: string;
  usage?: ChatCompletionResponse["usage"];
}

/**
 * Один вызов chat completion к локальной модели через LM Studio.
 * LM Studio держит модель "как есть" в памяти между вызовами, так что
 * повторные вызовы одной модели быстрее первого (первый прогревает контекст).
 */
export async function callModel(
  model: ModelConfig,
  systemPrompt: string,
  userPrompt: string
): Promise<CallResult> {
  const start = Date.now();

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const res = await fetch(`${LM_STUDIO_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model.modelName,
      messages,
      temperature: model.temperature ?? 0.2,
      max_tokens: model.maxTokens ?? 4096,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `LM Studio request failed: ${res.status} ${res.statusText} — ${text}`
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const durationMs = Date.now() - start;

  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error("LM Studio response has no choices — check model/server state");
  }

  return {
    content: choice.message.content,
    durationMs,
    finishReason: choice.finish_reason,
    usage: data.usage,
  };
}

/**
 * Проверка доступности сервера и вывод реальных id моделей,
 * загруженных в LM Studio прямо сейчас — полезно свериться с models.config.ts
 */
export async function listAvailableModels(): Promise<string[]> {
  const res = await fetch(`${LM_STUDIO_BASE_URL}/models`);
  if (!res.ok) {
    throw new Error(`Не удалось получить список моделей: ${res.status}`);
  }
  const data = (await res.json()) as { data: { id: string }[] };
  return data.data.map((m) => m.id);
}
