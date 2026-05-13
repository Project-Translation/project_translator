export type ReasoningStripResult = {
  text: string;
  didStrip: boolean;
};

function lastMatchGroup(text: string, re: RegExp): string | null {
  // Ensure global flag so we can iterate matches safely.
  const flags = re.flags.includes("g") ? re.flags : re.flags + "g";
  const r = new RegExp(re.source, flags);
  let m: RegExpExecArray | null = null;
  let last: RegExpExecArray | null = null;
  while ((m = r.exec(text)) !== null) {
    last = m;
  }
  return last && last[1] !== undefined ? String(last[1]) : null;
}

/**
 * 从“思考型模型”的输出中尽量剥离思考过程，只保留最终要写入目标文件的译文。
 *
 * 约定（启发式）：
 * - 若存在 <final>...</final>，优先取最后一个 final 块内容。
 * - 若存在 <think>/<analysis>/<reasoning> 块，移除这些块（含内部内容）。
 * - 若剥离后变成空字符串，则返回原始文本（避免写出空文件）。
 */
export function stripReasoningFromModelOutput(raw: string): ReasoningStripResult {
  if (!raw) {
    return { text: raw, didStrip: false };
  }

  let t = raw;
  let didStrip = false;
  const rawStartsWithReasoningBlock = /^\s*<\s*(think|analysis|reasoning)\s*>/i.test(raw);

  // 1) Prefer <final>...</final> only when it's very likely a wrapper (avoid breaking legitimate HTML).
  const looksLikeReasoningWrapper =
    /<\s*(think|analysis|reasoning)\s*>/i.test(t) ||
    /^\s*<\s*final\s*>[\s\S]*<\s*\/\s*final\s*>\s*$/.test(t);
  if (looksLikeReasoningWrapper) {
    const finalInner = lastMatchGroup(t, /<\s*final\s*>([\s\S]*?)<\s*\/\s*final\s*>/i);
    if (finalInner !== null) {
      t = finalInner;
      didStrip = true;
    }
  }

  // 2) Remove explicit reasoning blocks if present.
  const beforeBlocks = t;
  t = t.replace(
    /<\s*(think|analysis|reasoning)\s*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  );
  if (t !== beforeBlocks) {
    didStrip = true;
  }

  // 如果文本以 <think>/<analysis>/<reasoning> 开头，剥离块内容后常会留下多余空行。
  // 这里仅在“确实是推理包装”的情况下做最小化规整：将开头连续空行压缩为 1 行。
  if (rawStartsWithReasoningBlock) {
    t = t.replace(/^\n{2,}/, "\n");
  }

  // 3) Strip leading labels if model still outputs "思考/翻译" style headings.
  // Keep this conservative: only when both "思考" and a "译文/翻译/最终" marker exist.
  const hasThinkingMarker = /(?:^|\n)\s*(?:思考|Thoughts?)\s*[:：]/i.test(t);
  const marker = /(?:^|\n)\s*(?:最终翻译|最终答案|译文|翻译|Final)\s*[:：]\s*/gi;
  if (hasThinkingMarker) {
    const markerIdx = (() => {
      let idx = -1;
      let m: RegExpExecArray | null = null;
      while ((m = marker.exec(t)) !== null) {
        idx = m.index + m[0].length;
      }
      return idx;
    })();
    if (markerIdx >= 0 && markerIdx < t.length) {
      const sliced = t.slice(markerIdx);
      if (sliced.trim().length > 0) {
        t = sliced;
        didStrip = true;
      }
    }
  }

  // If we stripped too aggressively, avoid returning empty (prevents empty target files).
  if (didStrip && t.trim().length === 0 && raw.trim().length > 0) {
    return { text: raw, didStrip: false };
  }

  return { text: t, didStrip };
}
