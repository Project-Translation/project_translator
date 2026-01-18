const CODE_FENCE_LINE_RE = /^\s*```/;
const CODE_FENCE_ANYWHERE_RE = /^\s*```/m;

function hasCodeFenceLine(text: string): boolean {
  return CODE_FENCE_ANYWHERE_RE.test(text);
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

/**
 * Remove LLM-added markdown code fences (```lang ... ```), when they are not expected.
 *
 * Rules:
 * - If the original content contains no code fence lines, we remove all code fence lines from the translation.
 * - If the original contains fences but is not fully wrapped, and the translation is fully wrapped,
 *   we unwrap the outermost wrapper (keeping inner fences).
 */
export function sanitizeUnexpectedCodeFences(original: string, translated: string): string {
  if (!translated || translated === original) {
    return translated;
  }

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

