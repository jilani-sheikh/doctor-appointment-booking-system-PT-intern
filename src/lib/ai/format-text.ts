export interface FormattedSpan {
  text: string;
  bold: boolean;
}

export type FormattedBlock =
  | { kind: "heading"; spans: FormattedSpan[] }
  | { kind: "bullet"; spans: FormattedSpan[] }
  | { kind: "numbered"; numberLabel: string; spans: FormattedSpan[] }
  | { kind: "paragraph"; spans: FormattedSpan[] };

const COMMON_HONORIFICS = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|St)\.$/i;

/**
 * Parses inline **bold** / __bold__ markers while eliminating stray asterisks and backticks.
 */
export function parseInlineBoldSpans(rawLine: string): FormattedSpan[] {
  const withoutBackticks = rawLine.replaceAll("`", "");
  const segments: FormattedSpan[] = [];
  const boldRegex = /\*\*([^*\n]+?)\*\*|__([^_\n]+?)__/g;

  let cursor = 0;
  let match: RegExpExecArray | null;

  const pushCleaned = (rawText: string, bold: boolean) => {
    const cleaned = rawText
      .replace(/\*([^*\n]+?)\*/g, "$1")
      .replaceAll("*", "")
      .replace(/ {2,}/g, " ");
    if (!cleaned) return;
    const last = segments[segments.length - 1];
    if (last && last.bold === bold) {
      last.text += cleaned;
    } else {
      segments.push({ text: cleaned, bold });
    }
  };

  while ((match = boldRegex.exec(withoutBackticks)) !== null) {
    if (match.index > cursor) {
      pushCleaned(withoutBackticks.slice(cursor, match.index), false);
    }
    const inner = match[1] ?? match[2] ?? "";
    pushCleaned(inner, true);
    cursor = match.index + match[0].length;
  }

  if (cursor < withoutBackticks.length) {
    pushCleaned(withoutBackticks.slice(cursor), false);
  }

  if (segments.length > 0) {
    segments[0].text = segments[0].text.replace(/^\s+/, "");
    segments[segments.length - 1].text = segments[segments.length - 1].text.replace(/\s+$/, "");
  }

  return segments.filter((s) => s.text.length > 0);
}

/**
 * Strips raw Markdown asterisks and backticks into clean structured plain text.
 */
export function stripMarkdownAsterisks(raw: string): string {
  return parseFormattedAssistantBlocks(raw)
    .map((block) => {
      const text = block.spans.map((s) => s.text).join("");
      if (block.kind === "bullet") return `• ${text}`;
      if (block.kind === "numbered") return `${block.numberLabel} ${text}`;
      return text;
    })
    .join("\n")
    .trim();
}

/**
 * Parses raw LLM response text into clean headings, bullet items, numbered steps, and paragraphs
 * so zero raw Markdown `*` / `**` / `#` characters appear in chat bubbles.
 */
export function parseFormattedAssistantBlocks(raw: string): FormattedBlock[] {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const lines = normalized.split("\n");
  const blocks: FormattedBlock[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Ignore horizontal rule lines like *** or ---
    if (/^[-*_]{3,}$/.test(trimmed)) continue;

    const mdHeadingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (mdHeadingMatch) {
      const spans = parseInlineBoldSpans(mdHeadingMatch[1]);
      if (spans.length > 0) blocks.push({ kind: "heading", spans });
      continue;
    }

    const bulletMatch = trimmed.match(/^(?:[*+-]|•)\s+(.+)$/);
    if (bulletMatch) {
      const spans = parseInlineBoldSpans(bulletMatch[1]);
      if (spans.length > 0) blocks.push({ kind: "bullet", spans });
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+[.)])\s+(.+)$/);
    if (numberedMatch) {
      const spans = parseInlineBoldSpans(numberedMatch[2]);
      if (spans.length > 0) {
        blocks.push({
          kind: "numbered",
          numberLabel: numberedMatch[1].replace(")", "."),
          spans,
        });
      }
      continue;
    }

    // Standalone label ending with ':' when short and followed by list/content
    const labelHeadingMatch = trimmed.match(/^(?:\*\*|__)?([^*_\n:]{2,48}:)(?:\*\*|__)?$/);
    if (labelHeadingMatch && i + 1 < lines.length) {
      const spans = parseInlineBoldSpans(labelHeadingMatch[1]);
      if (spans.length > 0) blocks.push({ kind: "heading", spans });
      continue;
    }

    const spans = parseInlineBoldSpans(trimmed);
    if (spans.length > 0) {
      blocks.push({ kind: "paragraph", spans });
    }
  }

  return blocks;
}

/**
 * Normalizes AI assistant responses for natural, smooth browser SpeechSynthesis playback.
 */
export function cleanTextForSpeech(rawText: string): string {
  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return "";

  const spokenLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^[-*_]{3,}$/.test(line))
    .map((line) => {
      let cleaned = line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^(?:[*+-]|•|\d+[.)])\s+/, "")
        .replaceAll("**", "")
        .replaceAll("__", "")
        .replaceAll("`", "")
        .replace(/\*([^*\n]+?)\*/g, "$1")
        .replaceAll("*", "")
        // Speak Indian Rupee symbol naturally
        .replace(/₹\s*([\d,]+(?:\.\d+)?)/g, "$1 rupees")
        // Speak time ranges smoothly as "to" instead of abrupt dash pause
        .replace(
          /(\d{1,2}:\d{2}(?:\s*(?:am|pm|AM|PM))?)\s*[-–—]\s*(\d{1,2}:\d{2}(?:\s*(?:am|pm|AM|PM))?)/g,
          "$1 to $2"
        )
        .replace(/[–—]/g, ", ")
        .replace(/\s+/g, " ")
        .trim();

      if (cleaned && !/[.?!।,:;]$/.test(cleaned)) {
        cleaned += ".";
      } else if (cleaned.endsWith(":")) {
        cleaned = `${cleaned.slice(0, -1)}.`;
      }
      return cleaned;
    })
    .filter((line) => line.length > 0);

  return spokenLines
    .join(" ")
    .replace(/\.\s*\./g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Breaks cleaned speech text into natural sentence chunks to prevent browser TTS timeouts
 * on long replies and deliver smooth cadence.
 */
export function splitSpeechChunks(cleanedText: string, maxLength = 170): string[] {
  const trimmed = cleanedText.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLength) return [trimmed];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < trimmed.length; i += 1) {
    const ch = trimmed[i];
    const nextCh = trimmed[i + 1];
    const isBoundary =
      (ch === "." || ch === "?" || ch === "!" || ch === "।" || ch === ";") &&
      (nextCh === undefined || /\s/.test(nextCh));

    if (!isBoundary) continue;

    const candidate = trimmed.slice(start, i + 1).trim();
    if (ch === "." && COMMON_HONORIFICS.test(candidate)) {
      continue;
    }

    if (candidate) {
      sentences.push(candidate);
      start = i + 1;
    }
  }

  const tail = trimmed.slice(start).trim();
  if (tail) {
    sentences.push(tail);
  }

  const chunks: string[] = [];
  let current = "";

  const pushOversizedSentence = (sentence: string) => {
    const parts = sentence.split(/(?<=,)\s+/);
    let buf = "";
    for (const part of parts) {
      if (!buf) {
        buf = part;
      } else if (buf.length + 1 + part.length <= maxLength) {
        buf = `${buf} ${part}`;
      } else {
        chunks.push(buf);
        buf = part;
      }
    }
    if (buf) chunks.push(buf);
  };

  for (const sentence of sentences) {
    if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      pushOversizedSentence(sentence);
    } else if (!current) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= maxLength) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

