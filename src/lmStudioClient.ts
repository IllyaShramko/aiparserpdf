import { API_BASE_URL, API_PROVIDER, OPENROUTER_API_KEY } from "./models.config";
import { ModelConfig } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
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

function getRequestHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_PROVIDER === "openrouter" && OPENROUTER_API_KEY) {
    headers["Authorization"] = `Bearer ${OPENROUTER_API_KEY}`;
    headers["HTTP-Referer"] = "https://brainshard.ai";
    headers["X-Title"] = "BrainShard Research";
  }
  return headers;
}

/**
 * Вызов chat completion к LLM (LM Studio или OpenRouter).
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

  const res = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getRequestHeaders(),
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
      `API request failed (${API_PROVIDER}): ${res.status} ${res.statusText} — ${text}`
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const durationMs = Date.now() - start;

  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error(`API response has no choices (${API_PROVIDER}) — check model/key state`);
  }

  return {
    content: choice.message.content,
    durationMs,
    finishReason: choice.finish_reason,
    usage: data.usage,
  };
}

/**
 * Вызов vision-модели (OpenRouter или LM Studio) с передачей base64 картинки.
 */
export async function callVisionModel(
  model: ModelConfig,
  prompt: string,
  imageBase64: string
): Promise<CallResult> {
  const start = Date.now();

  const messages: ChatMessage[] = [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${imageBase64}`,
          },
        },
      ],
    },
  ];

  const res = await fetch(`${API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: getRequestHeaders(),
    body: JSON.stringify({
      model: model.modelName,
      messages,
      temperature: model.temperature ?? 0.0,
      max_tokens: model.maxTokens ?? 8192,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `Vision API request failed (${API_PROVIDER}): ${res.status} ${res.statusText} — ${text}`
    );
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const durationMs = Date.now() - start;

  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error(`Vision response has no choices (${API_PROVIDER}) — check model state`);
  }

  return {
    content: choice.message.content,
    durationMs,
    finishReason: choice.finish_reason,
    usage: data.usage,
  };
}

/**
 * Проверка доступности моделей.
 */
export async function listAvailableModels(): Promise<string[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/models`, {
      headers: getRequestHeaders(),
    });
    if (!res.ok) {
      if (API_PROVIDER === "openrouter") {
        return ["(OpenRouter API Key configured)"];
      }
      throw new Error(`Не удалось получить список моделей: ${res.status}`);
    }
    const data = (await res.json()) as { data: { id: string }[] };
    return data.data?.map((m) => m.id) || [];
  } catch (e) {
    if (API_PROVIDER === "openrouter") {
      return ["(OpenRouter Connected)"];
    }
    throw e;
  }
}
