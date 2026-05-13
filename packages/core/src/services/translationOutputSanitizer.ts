const CODE_FENCE_LINE_RE = /^\s*```/;
const CODE_FENCE_ANYWHERE_RE = /^\s*```/m;

const START_END_TAG_LINE_RE = /^\s*<\s*(?:start|end)\s+[^\s>]+\s*>\s*$/i;
const START_END_TAG_ANYWHERE_RE = /^\s*<\s*(?:start|end)\s+[^\s>]+\s*>\s*$/im;
const START_TAG_LINE_RE = /^\s*<\s*start\s+([^\s>]+)\s*>\s*$/i;
const END_TAG_LINE_RE = /^\s*<\s*end\s+([^\s>]+)\s*>\s*$/i;

function hasCodeFenceLine(text: string): boolean {
  return CODE_FENCE_ANYWHERE_RE.test(text);
}

function hasStartEndTagLine(text: string): boolean {
  return START_END_TAG_ANYWHERE_RE.test(text);
}

function detectLineEnding(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function stripAllCodeFenceLines(text: string): string {
  const eol = detectLineEnding(text);
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l) => !CODE_FENCE_LINE_RE.test(l));
  return kept.join(eol);
}

function stripAllStartEndTagLines(text: string): string {
  const eol = detectLineEnding(text);
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l) => !START_END_TAG_LINE_RE.test(l));
  return kept.join(eol);
}

function isFullyWrappedByOuterCodeFence(text: string): boolean {
  const t = text.trim();
  if (!CODE_FENCE_LINE_RE.test(t)) {
    return false;
  }

  // Outer wrapper: first line is ```<info?> and last line is ```
  // This intentionally only matches backtick-fences, because that's what the system prompt cares about.
  return /^```[^\r\n]*(?:\r?\n)[\s\S]*(?:\r?\n)```\s*$/.test(t);
}

function unwrapOuterCodeFence(text: string): string {
  const t = text.trim();
  const m = t.match(/^```[^\r\n]*(?:\r?\n)([\s\S]*)(?:\r?\n)```\s*$/);
  return m ? m[1] : text;
}

function isFullyWrappedByOuterStartEndTags(text: string): boolean {
  const t = text.trim();
  const lines = t.split(/\r?\n/);
  if (lines.length < 2) {
    return false;
  }

  const start = lines[0];
  const end = lines[lines.length - 1];
  const mStart = start.match(START_TAG_LINE_RE);
  const mEnd = end.match(END_TAG_LINE_RE);
  if (!mStart || !mEnd) {
    return false;
  }

  const langStart = (mStart[1] || '').trim();
  const langEnd = (mEnd[1] || '').trim();
  if (!langStart || !langEnd) {
    return false;
  }
  return langStart.toLowerCase() === langEnd.toLowerCase();
}

function unwrapOuterStartEndTags(text: string): string {
  const eol = detectLineEnding(text);
  const t = text.trim();
  const lines = t.split(/\r?\n/);
  if (lines.length < 2) {
    return text;
  }

  const mStart = lines[0].match(START_TAG_LINE_RE);
  const mEnd = lines[lines.length - 1].match(END_TAG_LINE_RE);
  if (!mStart || !mEnd) {
    return text;
  }

  const langStart = (mStart[1] || '').trim();
  const langEnd = (mEnd[1] || '').trim();
  if (!langStart || !langEnd || langStart.toLowerCase() !== langEnd.toLowerCase()) {
    return text;
  }

  const inner = lines.slice(1, lines.length - 1);
  return inner.join(eol);
}

function sanitizeUnexpectedStartEndTags(original: string, translated: string): string {
  const originalHasTags = hasStartEndTagLine(original);
  const translatedHasTags = hasStartEndTagLine(translated);

  if (!translatedHasTags) {
    return translated;
  }

  if (!originalHasTags) {
    return stripAllStartEndTagLines(translated);
  }

  const originalFullyWrapped = isFullyWrappedByOuterStartEndTags(original);
  const translatedFullyWrapped = isFullyWrappedByOuterStartEndTags(translated);
  if (!originalFullyWrapped && translatedFullyWrapped) {
    // Unwrap repeatedly in case the model nested wrappers (keep it bounded).
    let t = translated;
    for (let i = 0; i < 3; i++) {
      if (!isFullyWrappedByOuterStartEndTags(t)) {
        break;
      }
      t = unwrapOuterStartEndTags(t);
    }
    return t;
  }

  return translated;
}

/**
 * Remove LLM-added wrappers when they are not expected.
 *
 * Rules:
 * - If the original content contains no code fence lines, we remove all code fence lines from the translation.
 * - If the original contains fences but is not fully wrapped, and the translation is fully wrapped,
 *   we unwrap the outermost wrapper (keeping inner fences).
 * - If the original contains no <start ...>/<end ...> tag lines, we remove all such tag lines from the translation.
 * - If the original contains such tags but is not fully wrapped, and the translation is fully wrapped,
 *   we unwrap the outermost wrapper (keeping inner tags).
 */
export function sanitizeUnexpectedCodeFences(original: string, translated: string): string {
  if (!translated || translated === original) {
    return translated;
  }

  // First, remove/unwrap <start ...>/<end ...> wrapper tags if the model added them.
  const tagsSanitized = sanitizeUnexpectedStartEndTags(original, translated);
  if (!tagsSanitized || tagsSanitized === original) {
    return tagsSanitized;
  }

  translated = tagsSanitized;

  const originalHasFences = hasCodeFenceLine(original);
  const translatedHasFences = hasCodeFenceLine(translated);

  if (!translatedHasFences) {
    return translated;
  }

  if (!originalHasFences) {
    return stripAllCodeFenceLines(translated);
  }

  const originalFullyWrapped = isFullyWrappedByOuterCodeFence(original);
  const translatedFullyWrapped = isFullyWrappedByOuterCodeFence(translated);
  if (!originalFullyWrapped && translatedFullyWrapped) {
    // Unwrap repeatedly in case the model nested wrappers (keep it bounded).
    let t = translated;
    for (let i = 0; i < 3; i++) {
      if (!isFullyWrappedByOuterCodeFence(t)) {
        break;
      }
      t = unwrapOuterCodeFence(t);
    }
    return t;
  }

  return translated;
}

