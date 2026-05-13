function safeToString(x: unknown): string {
  try {
    return typeof x === "string" ? x : JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function formatCauseChain(err: any, maxDepth: number): string[] {
  const parts: string[] = [];
  let cur: any = err;
  for (let i = 0; i < maxDepth; i++) {
    const cause = cur?.cause;
    if (!cause) break;
    const name = typeof cause?.name === "string" ? cause.name : "Error";
    const message = typeof cause?.message === "string" ? cause.message : safeToString(cause);
    parts.push(`cause[${i + 1}]: ${name}: ${message}`);
    // Prefer next nested cause if present, otherwise stop.
    cur = cause;
  }
  return parts;
}

/**
 * 将未知错误格式化为可读日志（尽量保留原始信息，但避免过度打印敏感字段）。
 */
export function formatRawErrorForLog(error: unknown): string {
  if (!error) {
    return "null/undefined error";
  }

  if (error instanceof Error) {
    const name = error.name || "Error";
    const message = error.message || "";
    const stack = error.stack || "";
    const lines: string[] = [`${name}: ${message}`];
    const causes = formatCauseChain(error as any, 5);
    if (causes.length > 0) {
      lines.push(...causes);
    }
    if (stack) {
      lines.push(stack);
    }
    return lines.join("\n");
  }

  // OpenAI-compatible SDKs sometimes throw plain objects
  const t = safeToString(error);
  return t;
}

