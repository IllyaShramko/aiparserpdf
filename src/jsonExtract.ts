import { StructuralSplit } from "./types";

/**
 * Мелкие локальные модели часто:
 *  - оборачивают JSON в ```json ... ``` несмотря на явный запрет в промпте,
 *  - добавляют одну вводную фразу перед JSON ("Вот результат:"),
 *  - иногда обрывают JSON на maxTokens (незакрытые скобки),
 *  - КОПИРУЮТ "дословный" маркер вместе с реальным переносом строки (\n) или LaTeX-бэкслешами (\alpha, \(, \_)
 *    прямо внутрь значения строки в JSON, не экранируя их —
 *    JSON.parse падает с "Bad control character" или "Bad escaped character in JSON".
 * Эта функция вытаскивает JSON максимально терпимо и явно сообщает, что пошло не так.
 */
export function extractStructuralSplit(raw: string): {
  parsed: StructuralSplit | null;
  error: string | null;
} {
  let candidate = raw.trim();

  // Снимаем ```json ... ``` или просто ``` ... ```
  const codeBlockMatch = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    candidate = codeBlockMatch[1].trim();
  }

  // Если после снятия code block всё ещё есть текст до первой { — обрезаем
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    return { parsed: null, error: "Не найдены фигурные скобки JSON в ответе" };
  }
  candidate = candidate.slice(firstBrace, lastBrace + 1);

  // Экранируем непойманные control-символы и невалидные LaTeX-эскейпы (\alpha, \(, \_ и т.д.)
  candidate = sanitizeJsonStringLiterals(candidate);

  try {
    const parsed = JSON.parse(candidate) as StructuralSplit;
    if (!Array.isArray(parsed.modules)) {
      return { parsed: null, error: "JSON валиден, но поле 'modules' не массив" };
    }
    return { parsed, error: null };
  } catch (e) {
    const message = (e as Error).message;
    const looksTruncated =
      /Unexpected end of JSON input/.test(message) ||
      /Unexpected end of/.test(message);
    return {
      parsed: null,
      error: looksTruncated
        ? `JSON.parse упал: ${message}. Похоже, ответ обрезан по maxTokens (не хватило места закончить JSON) — попробуй увеличить maxTokens для этой модели в models.config.ts.`
        : `JSON.parse упал: ${message}. Это НЕ обрезка по maxTokens — скорее всего модель вернула невалидный JSON другого рода (проверь step1-raw-response.txt глазами).`,
    };
  }
}

/**
 * Проходит по JSON-строке посимвольно:
 * 1. Внутри строковых литералов экранирует сырые control-символы (код < 0x20).
 * 2. Исправляет невалидные экранирования (например \alpha, \(, \_, \*, \s -> \\alpha, \\(, \\_, \\*).
 */
function sanitizeJsonStringLiterals(json: string): string {
  let result = "";
  let insideString = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    const code = json.charCodeAt(i);

    if (!insideString) {
      if (ch === '"') {
        insideString = true;
      }
      result += ch;
      continue;
    }

    // Мы находимся ВНУТРИ строкового литерала
    if (ch === '"') {
      insideString = false;
      result += ch;
      continue;
    }

    if (ch === "\\") {
      const nextChar = i + 1 < json.length ? json[i + 1] : "";
      // Проверяем, является ли следующий символ валидным JSON escape: ", \, /, b, f, n, r, t, u
      const isValidEscape =
        nextChar === '"' ||
        nextChar === "\\" ||
        nextChar === "/" ||
        nextChar === "b" ||
        nextChar === "f" ||
        nextChar === "n" ||
        nextChar === "r" ||
        nextChar === "t" ||
        (nextChar === "u" && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6)));

      if (isValidEscape) {
        result += "\\";
        result += nextChar;
        i++; // Пропускаем уже обработанный следующий символ
      } else {
        // Невалидный backslash (например \(, \alpha, \_, \*, \s) -> экранируем сам backslash
        result += "\\\\";
      }
      continue;
    }

    if (code < 0x20) {
      // Сырой control-символ внутри строки — экранируем
      switch (ch) {
        case "\n":
          result += "\\n";
          break;
        case "\r":
          result += "\\r";
          break;
        case "\t":
          result += "\\t";
          break;
        default:
          result += "\\u" + code.toString(16).padStart(4, "0");
      }
      continue;
    }

    result += ch;
  }

  return result;
}
