import * as path from "path";

type HttpErrorLike = {
  status?: unknown;
  statusCode?: unknown;
  response?: { status?: unknown; statusCode?: unknown } | unknown;
  message?: unknown;
  error?: { message?: unknown; type?: unknown; code?: unknown } | unknown;
  headers?: Record<string, unknown> | unknown;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  return null;
}

function getNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function extractHttpStatus(err: unknown): number | null {
  const e = err as HttpErrorLike;
  const direct = getNumber(e?.status) ?? getNumber(e?.statusCode);
  if (direct !== null) return direct;

  const resp = e?.response as any;
  return getNumber(resp?.status) ?? getNumber(resp?.statusCode);
}

function extractVendorMessage(err: unknown): string | null {
  const e = err as HttpErrorLike;
  const msg =
    getString((e as any)?.error?.message) ??
    getString((e as any)?.error?.error?.message) ??
    getString((e as any)?.response?.data?.error?.message) ??
    getString(e?.message);
  return msg ? msg.trim() : null;
}

function extractRequestId(err: unknown): string | null {
  const headers = (err as HttpErrorLike)?.headers;
  const rec = asRecord(headers);
  if (!rec) return null;
  const rid = rec["x-request-id"] ?? rec["x-request_id"] ?? rec["request-id"];
  return getString(rid);
}

export function formatVendorHttpErrorForPopup(
  err: unknown,
  ctx: {
    vendorName: string;
    model?: string;
    sourcePath?: string;
    operation?: "translate" | "diff";
  }
): { key: string; message: string } | null {
  const status = extractHttpStatus(err);
  if (status === null) return null;

  const vendorMessage = extractVendorMessage(err) || "请求失败";
  const requestId = extractRequestId(err);

  const sourceHint = ctx.sourcePath
    ? `（文件：${path.basename(ctx.sourcePath)}）`
    : "";
  const opHint = ctx.operation === "diff" ? "差异化翻译" : "翻译";
  const modelHint = ctx.model ? `，model=${ctx.model}` : "";
  const ridHint = requestId ? `，request_id=${requestId}` : "";

  const message = `模型供应商 HTTP 错误：${opHint}请求返回 ${status}${sourceHint}\nvendor=${ctx.vendorName}${modelHint}${ridHint}\n${vendorMessage}`;

  const keyMsg = vendorMessage.length > 200 ? vendorMessage.slice(0, 200) : vendorMessage;
  const key = `${ctx.vendorName}|${ctx.model || ""}|${ctx.operation || ""}|${status}|${keyMsg}`;

  return { key, message };
}

