import { StructuralSplit } from "./types";

/**
 * Мелкие локальные модели часто:
 *  - оборачивают JSON в ```json ... ``` несмотря на явный запрет в промпте,
 *  - добавляют одну вводную фразу перед JSON ("Вот результат:"),
 *  - иногда обрывают JSON на maxTokens (незакрытые скобки),
 *  - КОПИРУЮТ "дословный" маркер вместе с реальным переносом строки (\n) из исходного
 *    PDF-текста прямо внутрь значения строки в JSON, не экранируя его как \\n —
 *    JSON.parse не прощает непойманные control-символы (0x00-0x1F) внутри строковых литералов
 *    и падает с "Bad control character in string literal", что легко перепутать с обрезкой по maxTokens.
 * Эта функция вытаскивает JSON максимально терпимо и явно сообщает, что пошло не так,
 * вместо того чтобы падать молча — для research важно видеть ПОЧЕМУ парсинг не удался.
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

  // Экранируем непойманные control-символы (перенос строки, таб и т.д.), которые модель
  // могла вставить "как есть" внутрь значения строки, скопировав кусок исходного текста.
  candidate = escapeRawControlCharsInStrings(candidate);

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
 * Проходит по JSON-строке посимвольно и, только находясь ВНУТРИ строкового литерала
 * (между непроэкранированными кавычками), заменяет сырые control-символы (код < 0x20)
 * на их корректные JSON-экранированные эквиваленты. Вне строк (структурные пробелы/переносы
 * между полями) ничего не трогает — там control-символы валидны и менять их не нужно.
 */
function escapeRawControlCharsInStrings(json: string): string {
  let result = "";
  let insideString = false;
  let isEscaped = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i];
    const code = json.charCodeAt(i);

    if (insideString && !isEscaped && code < 0x20) {
      // Сырой control-символ внутри строки — экранируем по JSON-правилам
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

    if (isEscaped) {
      isEscaped = false;
    } else if (ch === "\\" && insideString) {
      isEscaped = true;
    } else if (ch === '"') {
      insideString = !insideString;
    }
  }

  return result;
}
