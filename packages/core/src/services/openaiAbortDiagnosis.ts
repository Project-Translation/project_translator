import * as path from "path";

function getErrorName(error: unknown): string {
  if (error instanceof Error && typeof error.name === "string") {
    return error.name;
  }
  const maybeName = (error as { name?: unknown } | null | undefined)?.name;
  return typeof maybeName === "string" ? maybeName : "";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string") {
    return error.message;
  }
  const maybeMessage = (error as { message?: unknown } | null | undefined)?.message;
  return typeof maybeMessage === "string" ? maybeMessage : "";
}

function looksLikeOpenAIAbort(error: unknown): boolean {
  const name = getErrorName(error);
  const message = getErrorMessage(error);
  return name === "APIUserAbortError" || message === "Request was aborted.";
}

function formatContextFacts(ctx: {
  vendorName?: string;
  model?: string;
  sourcePath?: string;
}): string {
  const facts: string[] = [];
  if (ctx.vendorName) {
    facts.push(`vendor=${ctx.vendorName}`);
  }
  if (ctx.model) {
    facts.push(`model=${ctx.model}`);
  }
  if (ctx.sourcePath) {
    facts.push(`file=${path.basename(ctx.sourcePath)}`);
  }
  return facts.length > 0 ? `（${facts.join("，")}）` : "";
}

export function diagnoseOpenAIAbortError(
  error: unknown,
  ctx: {
    elapsedMs?: number;
    configuredTimeoutMs?: number;
    cancellationRequested?: boolean;
    vendorName?: string;
    model?: string;
    sourcePath?: string;
  }
): string | null {
  if (!looksLikeOpenAIAbort(error)) {
    return null;
  }

  const contextFacts = formatContextFacts(ctx);

  if (ctx.cancellationRequested) {
    return `OpenAI SDK 返回 Request was aborted.${contextFacts} 检测到取消令牌已触发，这是用户/上层取消导致的中止，不是模型自行报错。`;
  }

  const elapsedMs = ctx.elapsedMs;
  const configuredTimeoutMs = ctx.configuredTimeoutMs;
  const hasElapsedMs = typeof elapsedMs === "number" && Number.isFinite(elapsedMs);
  const hasConfiguredTimeoutMs =
    typeof configuredTimeoutMs === "number" && Number.isFinite(configuredTimeoutMs);

  if (hasElapsedMs && hasConfiguredTimeoutMs) {
    const timeoutGapMs = Math.abs((elapsedMs as number) - (configuredTimeoutMs as number));
    const nearTimeoutThresholdMs = Math.max(1500, Math.round((configuredTimeoutMs as number) * 0.05));

    if (timeoutGapMs <= nearTimeoutThresholdMs) {
      return `OpenAI SDK 返回 Request was aborted.${contextFacts} 本次请求在 ${(elapsedMs as number)}ms 被中止，与配置 timeout=${configuredTimeoutMs}ms 基本一致，可判定为超时触发的 abort。`;
    }

    if ((elapsedMs as number) < (configuredTimeoutMs as number)) {
      return `OpenAI SDK 返回 Request was aborted.${contextFacts} 本次请求在 ${(elapsedMs as number)}ms 提前中止，早于配置 timeout=${configuredTimeoutMs}ms，更像是上游代理、网关或模型供应商主动断开了连接。`;
    }

    return `OpenAI SDK 返回 Request was aborted.${contextFacts} 本次请求在 ${(elapsedMs as number)}ms 被中止，配置 timeout=${configuredTimeoutMs}ms；这不是用户取消，需继续排查上游连接或代理超时。`;
  }

  return `OpenAI SDK 返回 Request was aborted.${contextFacts} 未检测到取消令牌，通常表示超时信号或上游连接中断触发了 abort。`;
}
