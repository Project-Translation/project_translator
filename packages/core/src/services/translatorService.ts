import OpenAI from "openai";
import { getConfiguration } from "../config/config";
import type { Config } from "../config/config.types";
import { SupportedLanguage } from "../translationDatabase";
import { logMessage } from "../runtime/logging";
import * as path from "path";
import { AI_RETURN_CODE, getDiffSystemPrompt, getSystemPrompts } from "../config/prompt";
import { sanitizeUnexpectedCodeFences } from "./translationOutputSanitizer";
import { shouldWarnZeroEstimatedOutputTokens } from "./translationWarnings";
import { formatVendorHttpErrorForPopup } from "./vendorHttpError";
import { stripReasoningFromModelOutput } from "./translationReasoningStripper";
import { formatRawErrorForLog } from "./errorLog";
import { CancellationTokenLike, RuntimeContext } from "../runtime/types";
import { getRuntimeContext } from "../runtime/context";
// no fs usage here

// Store the last request timestamp for each vendor
const vendorLastRequest: Map<string, number> = new Map();
const structuredOutputCapabilityCache: Map<string, boolean> = new Map();

// AI return codes are now imported from prompt.js

export interface TranslationProgressCallback {
  (chunk: string): void;
}

function extractTextFromMessageContent(messageContent: unknown): string {
  if (typeof messageContent === "string") {
    return messageContent;
  }
  // Some OpenAI-compatible vendors may return an array of content parts.
  if (Array.isArray(messageContent)) {
    return messageContent
      .map((p: any) => {
        if (!p) return "";
        if (typeof p === "string") return p;
        if (typeof p.text === "string") return p.text;
        if (typeof p.content === "string") return p.content;
        return "";
      })
      .join("");
  }
  return "";
}

function extractTextFromDeltaContent(deltaContent: unknown): string {
  if (typeof deltaContent === "string") {
    return deltaContent;
  }
  // Some vendors may stream content as an array of parts.
  if (Array.isArray(deltaContent)) {
    return deltaContent
      .map((p: any) => {
        if (!p) return "";
        if (typeof p === "string") return p;
        if (typeof p.text === "string") return p.text;
        if (typeof p.content === "string") return p.content;
        return "";
      })
      .join("");
  }
  return "";
}

function findFirstBalancedJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
      continue;
    }

    if (ch === "}") {
      if (depth === 0) {
        continue;
      }
      depth--;
      if (depth === 0 && start >= 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

function collectJsonCandidates(rawContent: string): string[] {
  const candidates = new Set<string>();
  const trimmed = rawContent.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fencedMatches = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/gi);
  if (fencedMatches) {
    for (const fencedBlock of fencedMatches) {
      const innerMatch = fencedBlock.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      const inner = innerMatch?.[1]?.trim();
      if (inner) {
        candidates.add(inner);
      }
    }
  }

  const taggedMatch = trimmed.match(/<start json>\s*([\s\S]*?)\s*<end json>/i);
  if (taggedMatch?.[1]) {
    candidates.add(taggedMatch[1].trim());
  }

  const balanced = findFirstBalancedJsonObject(trimmed);
  if (balanced) {
    candidates.add(balanced.trim());
  }

  return Array.from(candidates).filter((candidate) => candidate.length > 0);
}

function parseDiffJsonResponse(rawContent: string): {
  has_changes: boolean;
  changes: Array<{ start_line: number; search: string; replace: string }>;
} {
  const candidates = collectJsonCandidates(rawContent);
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        has_changes?: unknown;
        changes?: unknown;
      };
      if (!parsed || typeof parsed !== "object") {
        continue;
      }

      const hasChanges = !!parsed.has_changes;
      const rawChanges = Array.isArray(parsed.changes) ? parsed.changes : [];

      const normalizedChanges = rawChanges
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((item) => {
          const startLineRaw = item.start_line;
          const startLine =
            typeof startLineRaw === "number" && Number.isFinite(startLineRaw)
              ? Math.max(1, Math.floor(startLineRaw))
              : 1;
          const search = typeof item.search === "string" ? item.search : "";
          const replace = typeof item.replace === "string" ? item.replace : "";
          return { start_line: startLine, search, replace };
        })
        .filter((change) => change.search.length > 0);

      return {
        has_changes: hasChanges,
        changes: normalizedChanges,
      };
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  throw new Error("No valid JSON object found in model response");
}

function isBadRequestError(error: unknown): boolean {
  const maybeError = error as {
    status?: unknown;
    statusCode?: unknown;
    response?: { status?: unknown; statusCode?: unknown } | unknown;
  };
  const directStatus =
    typeof maybeError?.status === "number"
      ? maybeError.status
      : typeof maybeError?.statusCode === "number"
      ? maybeError.statusCode
      : null;
  if (directStatus !== null) {
    return directStatus === 400;
  }

  const response = maybeError?.response as { status?: unknown; statusCode?: unknown } | undefined;
  const responseStatus =
    typeof response?.status === "number"
      ? response.status
      : typeof response?.statusCode === "number"
      ? response.statusCode
      : null;
  return responseStatus === 400;
}

type HiddenTagName = "think" | "analysis" | "reasoning" | null;

/**
 * 轻量的流式过滤器：去除 <think>/<analysis>/<reasoning>...</...> 块内的内容，避免写入目标文件。
 * 该过滤器仅处理这些显式标签；更复杂的“思考/翻译”标题式输出在最终结果阶段再做剥离。
 */
class ReasoningTagStreamFilter {
  private inHidden: HiddenTagName = null;
  private carry = "";
  private readonly keepTail = 32;

  public process(input: string): string {
    if (!input) return "";
    let buf = this.carry + input;
    let out = "";
    this.carry = "";

    const openRe = /<\s*(think|analysis|reasoning)\s*>/i;
    const closeRe = (tag: string) => new RegExp(`<\\s*\\/\\s*${tag}\\s*>`, "i");

    // Bound the loop even on adversarial content.
    for (let guard = 0; guard < 10000 && buf.length > 0; guard++) {
      if (!this.inHidden) {
        const m = buf.match(openRe);
        if (!m || m.index === undefined) {
          if (buf.length <= this.keepTail) {
            this.carry = buf;
            break;
          }
          out += buf.slice(0, buf.length - this.keepTail);
          this.carry = buf.slice(buf.length - this.keepTail);
          break;
        }

        const idx = m.index;
        out += buf.slice(0, idx);
        const tag = String(m[1] || "").toLowerCase() as HiddenTagName;
        const endIdx = idx + m[0].length;
        buf = buf.slice(endIdx);
        this.inHidden = tag;
        continue;
      }

      // in hidden block: skip until matching close tag
      const tag = this.inHidden;
      if (!tag) {
        this.inHidden = null;
        continue;
      }
      const cRe = closeRe(tag);
      const mClose = buf.match(cRe);
      if (!mClose || mClose.index === undefined) {
        // Keep a small tail in case the close tag is split across chunks.
        if (buf.length > this.keepTail) {
          buf = buf.slice(buf.length - this.keepTail);
        }
        this.carry = buf;
        break;
      }
      const endIdx = mClose.index + mClose[0].length;
      buf = buf.slice(endIdx);
      this.inHidden = null;
    }

    return out;
  }

  public flush(): string {
    const tail = this.carry;
    this.carry = "";
    // If we ended while "inHidden", dropping the tail is safer than leaking reasoning.
    if (this.inHidden) {
      return "";
    }
    return tail;
  }
}

function isSseCommentLine(line: string): boolean {
  // Generic SSE comment shape. Keep this strict to avoid filtering normal text.
  return /^\s*:\s*[A-Z][A-Z0-9 _-]{2,}\s*$/.test(line);
}

function safeStringifyForLog(x: unknown): string {
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

function makeModelCapabilityCacheKey(apiEndpoint: string, model: string): string {
  return `${apiEndpoint}::${model}`;
}

function extractProviderErrorMessage(error: unknown): string {
  const err = error as {
    message?: unknown;
    error?: { message?: unknown } | unknown;
    response?: { data?: { error?: { message?: unknown } | unknown } | unknown } | unknown;
  };
  const direct = typeof err?.message === "string" ? err.message : "";
  if (direct) {
    return direct;
  }
  const nestedError = err?.error as { message?: unknown } | undefined;
  if (nestedError && typeof nestedError.message === "string") {
    return nestedError.message;
  }
  const responseData = (err?.response as { data?: unknown } | undefined)?.data as
    | { error?: { message?: unknown } | unknown }
    | undefined;
  const responseError = responseData?.error as { message?: unknown } | undefined;
  if (responseError && typeof responseError.message === "string") {
    return responseError.message;
  }
  return "";
}

export class TranslatorService {
  private openaiClient: OpenAI | null = null;
  private runtimeContext: RuntimeContext;
  private projectTotalInputTokens = 0;
  private projectTotalOutputTokens = 0;
  private workspaceRoot: string | null = null;
  private shownVendorHttpErrorKeys: Set<string> = new Set();
  private warnedStructuredDowngradeKeys: Set<string> = new Set();
  private configSnapshot: Config | null = null;

  constructor(runtimeContext?: RuntimeContext) {
    this.runtimeContext = runtimeContext || getRuntimeContext();
    this.workspaceRoot = this.runtimeContext.workspaceRoot || null;
  }

  private async ensureConfigSnapshot(): Promise<Config> {
    if (this.configSnapshot) {
      return this.configSnapshot;
    }
    const config = await getConfiguration();
    this.configSnapshot = config;
    return config;
  }

  private async requestDiffResponseText(
    payloadBase: Record<string, unknown>,
    useStream: boolean,
    debug: boolean
  ): Promise<string> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    if (!useStream) {
      const response = await this.openaiClient.chat.completions.create(
        payloadBase as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming
      );
      return extractTextFromMessageContent(response.choices?.[0]?.message?.content).trim();
    }

    const streamPayload = {
      ...payloadBase,
      stream: true,
    };
    const stream = await this.openaiClient.chat.completions.create(
      streamPayload as unknown as OpenAI.ChatCompletionCreateParamsStreaming
    );

    let rawContent = "";
    let rawReasoning = "";

    for await (const chunk of stream) {
      const delta = (chunk?.choices as any)?.[0]?.delta || {};
      const deltaText = extractTextFromDeltaContent(delta?.content);
      if (deltaText) {
        rawContent += deltaText;
      }

      const deltaReasoning =
        (typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "") ||
        (typeof delta?.thinking === "string" ? delta.thinking : "") ||
        (typeof delta?.reasoning === "string" ? delta.reasoning : "") ||
        "";
      if (deltaReasoning) {
        rawReasoning += deltaReasoning;
      }

      if (debug && deltaText) {
        logMessage(`🐛 [DEBUG] [diff-stream] delta.content: ${deltaText}`);
      }
      if (debug && deltaReasoning) {
        logMessage(`🐛 [DEBUG] [diff-stream] delta.reasoning: ${deltaReasoning}`);
      }
    }

    if (rawContent.trim().length > 0) {
      return rawContent.trim();
    }

    if (rawReasoning.trim().length > 0) {
      logMessage(
        "⚠️ Diff stream returned empty delta.content; fallback to delta.reasoning for JSON extraction",
        "warn"
      );
      return rawReasoning.trim();
    }

    return "";
  }

  public async initializeOpenAIClient() {
    const { currentVendor } = await this.ensureConfigSnapshot();
    const { apiEndpoint, apiKey, apiKeyEnvVarName, model, timeout } = currentVendor;
    
    let finalApiKey = apiKey;
    if (!finalApiKey && apiKeyEnvVarName) {
      finalApiKey = process.env[apiKeyEnvVarName];
      if (finalApiKey) {
        logMessage(
          `🔑 Using API key from environment variable: ${apiKeyEnvVarName}`
        );
      }
    }
    
    if (!finalApiKey) {
      logMessage(
        "❌ API key is not set in the vendor configuration or environment variable",
        "error"
      );
      throw new Error("API key is not set in the vendor configuration or environment variable");
    }
    
    if (!apiEndpoint) {
      logMessage(
        "❌ API endpoint is not set in the vendor configuration",
        "error"
      );
      throw new Error("API endpoint is not set in the vendor configuration");
    }
    if (!model) {
      logMessage(
        "❌ Model is not set in the vendor configuration",
        "error"
      );
      throw new Error("Model is not set in the vendor configuration");
    }

    logMessage(
      `🔑 Using vendor API endpoint: ${apiEndpoint}`
    );
    const config: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey: finalApiKey,
      baseURL: apiEndpoint,
    };

    const timeoutMs = timeout ? timeout * 1000 : 300000;
    logMessage(
      `⏱️ API request timeout setting: ${
        timeout || 180
      } seconds (${timeoutMs}ms)`
    );
    config.timeout = timeoutMs;

    this.openaiClient = new OpenAI(config);
  }

  /**
   * 解析AI返回的无需翻译响应
   * 新格式: "理由 | UUID"
   * 旧格式: "UUID" (向后兼容)
   * @returns 返回对象 { hasReason: boolean, reason?: string }
   */
  private parseNoNeedTranslateResponse(content: string): { hasReason: boolean; reason?: string } {
    const delimiter = " | ";
    if (content.includes(delimiter)) {
      const parts = content.split(delimiter);
      if (parts.length >= 2) {
        // 检查最后一部分是否包含UUID
        const lastPart = parts[parts.length - 1].trim();
        if (lastPart.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE)) {
          // 格式: 理由 | UUID
          const reason = parts.slice(0, -1).join(delimiter).trim();
          return { hasReason: true, reason };
        }
      }
    }
    return { hasReason: false };
  }

  public async translateContent(
    content: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage,
    sourcePath: string,
    cancellationToken?: CancellationTokenLike,
    progressCallback?: TranslationProgressCallback,
    isFirstSegment: boolean = true // Add parameter to indicate if this is the first segment
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      const error = "OpenAI client not initialized";
      logMessage(`❌ ${error}`, "error");
      throw new Error(error);
    }

    const config = await this.ensureConfigSnapshot();
    const { currentVendorName, currentVendor, customPrompts } = config;
    const debug = !!config.debug;
    // Ensure temperature has a sensible default if undefined
    const { model, rpm, streamMode } = currentVendor;
    const temperature = currentVendor.temperature === undefined ? 0.1 : currentVendor.temperature;
    const vendorTimeoutSeconds = currentVendor.timeout === undefined ? 180 : currentVendor.timeout;
    const streamIdleTimeoutMs = Math.max(1000, vendorTimeoutSeconds * 1000);

    logMessage(`🤖 Using model: ${model}`);
    logMessage(`🌐 Target language: ${targetLang}`);
    logMessage(`🎲 Temperature: ${temperature}`);

    if (streamMode) {
      logMessage(`🔄 Stream mode enabled`);
    } // Wait for RPM limit if needed
    if (rpm && rpm > 0) {
      await this.handleRpmLimit(currentVendorName, rpm, cancellationToken);
    }

	    // Prepare system prompts based on whether this is the first segment
	    const { part1, part2, customPromptSectionTitle } = getSystemPrompts(
	      config.systemPromptLanguage
	    );
	    let effectiveSystemPrompts: string[];
	    if (isFirstSegment) {
	      // For the first segment, use both parts of the default system prompt
	      effectiveSystemPrompts = [part1, part2];
	    } else {
	      // For subsequent segments, use only the first part
	      effectiveSystemPrompts = [part1];
	    }

    // Merge default system prompts with user custom prompts
    let mergedSystemPrompt = effectiveSystemPrompts.join("\n");

	    // Append user custom prompts to system prompt
	    if (customPrompts && customPrompts.length > 0) {
	      mergedSystemPrompt += `\n\n${customPromptSectionTitle}\n\n`;
	      mergedSystemPrompt += customPrompts.join("\n\n");
	    }

    // Message ordering per requirement:
    // 1) system: default system prompts + custom prompts
    // 2) user: raw content
    // 3) user: built-in translation prompt
    const messages: Array<{ role: string; content: string }> = [
      {
        role: "system",
        content: mergedSystemPrompt,
      },
      {
        role: "user",
        content: content,
      },
      {
        role: "user",
        content: `Please translate the preceding content from ${sourceLang} to ${targetLang}.`,
      },
    ];

    try {
      logMessage("📤 Sending translation request...");

      // Use stream mode if enabled and progressCallback is provided
      if (streamMode && progressCallback) {
        return await this.streamTranslateContent(
          messages,
          model || "",
          temperature,
          currentVendorName,
          content,
          progressCallback,
          cancellationToken,
          debug,
          currentVendor.top_p,
          sourcePath,
          streamIdleTimeoutMs
        );
      } else {
        return await this.standardTranslateContent(
          messages,
          model || "",
          temperature,
          currentVendorName,
          content,
          debug,
          currentVendor.top_p,
          sourcePath
        );
      }
    } catch (error) {
      // 打印原始错误（含 stack/cause），便于排查诸如 "Premature close" 这类底层连接错误
      logMessage(`❌ [RAW ERROR] ${formatRawErrorForLog(error)}`, "error");

      const popup = formatVendorHttpErrorForPopup(error, {
        vendorName: currentVendorName,
        model,
        sourcePath,
        operation: "translate",
      });
      if (popup && !this.shownVendorHttpErrorKeys.has(popup.key)) {
        this.shownVendorHttpErrorKeys.add(popup.key);
        this.runtimeContext.notifier.showError(popup.message);
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logMessage(`❌ Translation failed: ${errorMessage}`, "error");
      throw error;
    }
  }

  /**
   * 生成 Roo-Code 风格的 SEARCH/REPLACE 差异块
   * 要求模型严格输出由多个 SEARCH/REPLACE 块组成的纯文本，不得包含围栏或解释
   */
  public async generateSearchReplaceDiff(
    sourceContent: string,
    targetContent: string,
    sourcePath: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage
  ): Promise<string> {
    if (!this.openaiClient) {
      const error = "OpenAI client not initialized";
      logMessage(`❌ ${error}`, "error");
      throw new Error(error);
    }

    const config = await this.ensureConfigSnapshot();
    const { currentVendorName, currentVendor, customPrompts } = config;
    const debug = !!config.debug;
    const {
      part1,
      part2,
      diffSystemPrompt,
      customPromptSectionTitle,
    } = getSystemPrompts(config.systemPromptLanguage);

    // Build system prompt with default prompts and diff prompt
    let mergedSystemPrompt = [part1, part2, diffSystemPrompt].join("\n");

    // Append user custom prompts to system prompt
    if (customPrompts && customPrompts.length > 0) {
      mergedSystemPrompt += `\n\n${customPromptSectionTitle}\n\n`;
      mergedSystemPrompt += customPrompts.join("\n\n");
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: mergedSystemPrompt },
	      {
	        role: "system",
	        content: getDiffSystemPrompt(
	          sourceLang,
	          targetLang,
	          sourcePath,
	          config.systemPromptLanguage
	        ),
	      },
      // 先提供 SOURCE 后提供 TARGET，便于模型对齐
      { role: "user", content: `SOURCE BEGIN\n${sourceContent}\nSOURCE END` },
      { role: "user", content: `TARGET BEGIN\n${targetContent}\nTARGET END` }
    ];

    logMessage(`🔄 Sending differential translation request...`);
    logMessage(`🔄 Messages: ${JSON.stringify(messages, null, 2)}`);

    const diffResponseSchema = {
      type: "json_schema",
      json_schema: {
        name: "translation_diff",
        strict: true,
        schema: {
          type: "object",
          properties: {
            has_changes: { type: "boolean" },
            changes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start_line: { type: "integer", minimum: 1 },
                  search: { type: "string" },
                  replace: { type: "string" },
                },
                required: ["start_line", "search", "replace"],
                additionalProperties: false,
              },
            },
          },
          required: ["has_changes", "changes"],
          additionalProperties: false,
        },
      },
    } as const;

    const basePayload: Record<string, unknown> = {
      model: currentVendor.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: currentVendor.temperature,
      top_p: currentVendor.top_p,
    };
    const diffUsesStream = !!currentVendor.streamMode;

    const handleDiffRequestError = (error: unknown): void => {
      logMessage(`❌ [RAW ERROR] ${formatRawErrorForLog(error)}`, "error");
      const popup = formatVendorHttpErrorForPopup(error, {
        vendorName: currentVendorName,
        model: currentVendor.model,
        sourcePath,
        operation: "diff",
      });
      if (popup && !this.shownVendorHttpErrorKeys.has(popup.key)) {
        this.shownVendorHttpErrorKeys.add(popup.key);
        this.runtimeContext.notifier.showError(popup.message);
      }
    };

    const capabilityKey = makeModelCapabilityCacheKey(
      currentVendor.apiEndpoint,
      currentVendor.model
    );
    const canUseStructuredOutput = structuredOutputCapabilityCache.get(capabilityKey) !== false;

    const payloadWithStructured: Record<string, unknown> = canUseStructuredOutput
      ? {
          ...basePayload,
          response_format: diffResponseSchema,
        }
      : basePayload;

    let content = "";
    try {
      content = await this.requestDiffResponseText(
        payloadWithStructured,
        diffUsesStream,
        debug
      );
      if (canUseStructuredOutput) {
        structuredOutputCapabilityCache.set(capabilityKey, true);
      }
    } catch (error) {
      // If structured output is not accepted at runtime, retry without response_format.
      if (!canUseStructuredOutput || !isBadRequestError(error)) {
        handleDiffRequestError(error);
        throw error;
      }

      structuredOutputCapabilityCache.set(capabilityKey, false);
      if (!this.warnedStructuredDowngradeKeys.has(capabilityKey)) {
        this.warnedStructuredDowngradeKeys.add(capabilityKey);
        const providerMessage = extractProviderErrorMessage(error);
        logMessage(
          `⚠️ Structured response_format was rejected by current model/provider; fallback to plain JSON parsing from text stream. ${providerMessage ? `detail: ${providerMessage}` : ""}`.trim(),
          "warn"
        );
      }
      logMessage(
        "⚠️ Diff request returned 400 with structured response_format; retrying without response_format",
        "warn"
      );
      try {
        content = await this.requestDiffResponseText(basePayload, diffUsesStream, debug);
      } catch (retryError) {
        handleDiffRequestError(retryError);
        throw retryError;
      }
    }
    vendorLastRequest.set(currentVendorName, Date.now());

    // Parse JSON response and convert to SEARCH/REPLACE format
    try {
      const diffResult = parseDiffJsonResponse(content);

      if (!diffResult.has_changes || !diffResult.changes || diffResult.changes.length === 0) {
        logMessage("ℹ️ No changes detected in diff");
        return "";
      }

      // Convert JSON to SEARCH/REPLACE format
      const searchReplaceBlocks = diffResult.changes.map((change) => {
        return `<<<<<<< SEARCH
:start_line: ${change.start_line}
-------
${change.search}
=======
${change.replace}
>>>>>>> REPLACE`;
      }).join("\n\n");

      logMessage(`✅ Converted JSON diff to SEARCH/REPLACE format (${diffResult.changes.length} blocks)`);
      return searchReplaceBlocks;
    } catch (e) {
      logMessage(`❌ Failed to parse JSON diff response: ${e instanceof Error ? e.message : String(e)}`, "error");
      logMessage(`📄 Raw response: ${content}`);
      throw new Error(`Failed to parse JSON diff response: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private async standardTranslateContent(
    messages: Array<{ role: string; content: string }>,
    model: string,
    temperature: number | undefined,
    currentVendorName: string,
    originalContent: string,
    debug: boolean | undefined,
    topP: number | undefined,
    sourcePath: string = ""
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    // Record start time for API request
    const startTime = Date.now();
    logMessage(`⏱️ Starting OpenAI API request at ${new Date(startTime).toISOString()}`);

    const requestPayload: any = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
    };

    // Add top_p to request if it's set
    if (topP !== undefined) {
      requestPayload.top_p = topP;
    }

    // Debug: Log request payload
    if (debug) {
      logMessage(`🐛 [DEBUG] OpenAI API Request:`);
      logMessage(`🐛 [DEBUG] ${JSON.stringify(requestPayload, null, 2)}`);
    }

    const response = await this.openaiClient.chat.completions.create(requestPayload);

    // Record end time and calculate duration
    const endTime = Date.now();
    const duration = endTime - startTime;
    logMessage(`⏱️ OpenAI API request completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

    // Debug: Log response
    if (debug) {
      logMessage(`🐛 [DEBUG] OpenAI API Response:`);
      logMessage(`🐛 [DEBUG] ${JSON.stringify(response, null, 2)}`);
    }

    // Update the timestamp regardless of translation status
    vendorLastRequest.set(currentVendorName, Date.now());

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    logMessage(
      `📥 Translation request completed (input: ${inputTokens} tokens, output: ${outputTokens} tokens)`
    );

    this.projectTotalInputTokens += inputTokens;
    this.projectTotalOutputTokens += outputTokens;

    const translatedContent =
      extractTextFromMessageContent((response.choices as any)?.[0]?.message?.content) || originalContent;

    // 先用 raw 内容判断 NO_NEED_TRANSLATE（即使它出现在思考块里也应命中）。
    if (translatedContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE)) {
      const parsed = this.parseNoNeedTranslateResponse(translatedContent);
      if (parsed.hasReason) {
        logMessage(
          `🔄 AI indicated no translation needed for this file. Reason: ${parsed.reason}`
        );
      } else {
        logMessage(
          `🔄 AI indicated no translation needed for this file, skipping translation`
        );
      }
      return [AI_RETURN_CODE.NO_NEED_TRANSLATE, originalContent]; // Return the original content unchanged
    }

    const stripped = stripReasoningFromModelOutput(translatedContent);
    if (debug && stripped.didStrip) {
      logMessage(`🐛 [DEBUG] Stripped reasoning/thinking from translation response`);
    }
    const candidate = stripped.text;

    const sanitizedContent = sanitizeUnexpectedCodeFences(originalContent, candidate);
    if (debug && sanitizedContent !== candidate) {
      logMessage(`🐛 [DEBUG] Stripped unexpected code fences from translation response`);
    }

    return [AI_RETURN_CODE.OK, sanitizedContent];
  }

  private async streamTranslateContent(
    messages: Array<{ role: string; content: string }>,
    model: string,
    temperature: number | undefined,
    currentVendorName: string,
    originalContent: string,
    progressCallback: TranslationProgressCallback,
    cancellationToken?: CancellationTokenLike,
    debug: boolean | undefined = false,
    topP: number | undefined = undefined,
    sourcePath: string = "",
    streamIdleTimeoutMs: number = 180000
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    logMessage(`🔄 Starting streaming translation...`);
    const reasoningFilter = new ReasoningTagStreamFilter();
    let fullContent = ""; // filtered translation-only stream
    let rawAssistantContent = ""; // raw delta.content/text (may include think tags)
    let rawReasoningContent = ""; // delta.reasoning_content/thinking (should not be written to file)
    let sawAnyDeltaContent = false;
    let reasoningOnlyBuffer = ""; // 某些供应商会把“最终输出”错误地放在 delta.reasoning 里，先缓冲，若后续出现 content 则丢弃
    let foundNoNeedTranslate = false;

    // Extract the first part of the UUID to detect partial occurrences
    const uuidFirstPart = AI_RETURN_CODE.NO_NEED_TRANSLATE.substring(0, 20);

    // Record start time for streaming API request
    const startTime = Date.now();
    logMessage(`⏱️ Starting OpenAI streaming API request at ${new Date(startTime).toISOString()}`);

    const requestPayload: any = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
      stream: true,
    };

    // Add top_p to request if it's set
    if (topP !== undefined) {
      requestPayload.top_p = topP;
    }

    // Debug: Log request payload
    if (debug) {
      logMessage(`🐛 [DEBUG] OpenAI Streaming API Request:`);
      logMessage(`🐛 [DEBUG] ${JSON.stringify(requestPayload, null, 2)}`);
    }

    const abortController = new (globalThis as any).AbortController();
    let inactivityAbortReason: Error | null = null;
    let idleTimer: NodeJS.Timeout | null = null;
    let lastMessageAt = Date.now();
    const armIdleTimer = () => {
      lastMessageAt = Date.now();
      if (idleTimer) {
        globalThis.clearTimeout(idleTimer as any);
      }
      idleTimer = globalThis.setTimeout(() => {
        const now = Date.now();
        const idleForMs = now - lastMessageAt;
        inactivityAbortReason = new Error(
          `流式传输超时：距离上一条 stream 消息已过去 ${idleForMs}ms（设置 timeout=${streamIdleTimeoutMs}ms），终止当前文件翻译：${sourcePath || "(unknown sourcePath)"}`
        );
        try {
          abortController.abort();
        } catch {
          // ignore
        }
      }, streamIdleTimeoutMs) as any;
    };
    armIdleTimer();

    const stream = await (this.openaiClient.chat.completions.create(
      requestPayload,
      { signal: abortController.signal } as any
    ) as any);

    // Update request timestamp at the start of streaming
    vendorLastRequest.set(currentVendorName, Date.now());

    // Initialize token counters - this is an estimate since the streaming API doesn't provide token counts
    let estimatedInputTokens = 0;
    let estimatedOutputTokens = 0;

    let ignoredMalformedChunkCount = 0;
    const warnIgnoredMalformedChunk = (reason: string, detail?: string) => {
      ignoredMalformedChunkCount++;
      // 防止 Output Channel 被刷屏：只对前几条和之后的周期性条目输出 warn
      const shouldWarn =
        ignoredMalformedChunkCount <= 5 || ignoredMalformedChunkCount % 200 === 0;
      if (!shouldWarn) {
        return;
      }
      const trimmed =
        detail && detail.length > 240 ? `${detail.slice(0, 240)}…` : detail;
      logMessage(
        `⚠️ [stream] 已忽略不符合数据结构的消息（${reason}）${
          trimmed ? `: ${trimmed}` : ""
        }`,
        "warn"
      );
    };

    let lastFinishReason: string | null = null;
    let lastNativeFinishReason: string | null = null;

    // Estimate input tokens based on input messages
    for (const message of messages) {
      // Rough estimate: 1 token ≈ 4 characters for English
      estimatedInputTokens += Math.ceil(message.content.length / 4);
    }

    try {
      for await (const chunk of stream) {
      if (cancellationToken?.isCancellationRequested) {
        logMessage("⛔ Translation cancelled", "warn");
        throw this.runtimeContext.createCancellationError();
      }

      // 收到任何 chunk（包含将被忽略的异常结构）都视为“流仍在活跃”，重置 idle 超时计时器
      armIdleTimer();

      // 用户开启 debug 时，要求将所有流式返回消息原样输出（包括将被忽略的注释行/异常结构）。
      if (debug) {
        logMessage(`🐛 [DEBUG] [stream] RAW: ${safeStringifyForLog(chunk)}`);
      }

      // Some OpenAI-compatible providers use raw SSE comments (e.g. ": PROCESSING").
      // These lines are not JSON/data events and must be ignored without breaking the stream.
      if (typeof chunk === "string") {
        if (isSseCommentLine(chunk)) {
          warnIgnoredMalformedChunk("SSE comment line", chunk);
          continue;
        }
        // Unknown raw line: ignore but keep a breadcrumb in debug.
        warnIgnoredMalformedChunk("non-JSON stream line", chunk);
        continue;
      }

      // Some OpenAI-compatible SDKs may yield non-standard objects/events; ignore them safely.
      if (!chunk || typeof chunk !== "object") {
        warnIgnoredMalformedChunk("non-object chunk", String(chunk));
        continue;
      }

      const choices: any[] | undefined = (chunk as any).choices;
      if (!Array.isArray(choices) || choices.length === 0) {
        warnIgnoredMalformedChunk(
          "chunk without choices",
          JSON.stringify(chunk)
        );
        continue;
      }

      // Track finish reasons if provided by vendor (useful for diagnosing "why stream ended").
      const finishReason = typeof choices[0]?.finish_reason === "string" ? choices[0].finish_reason : null;
      const nativeFinishReason = typeof choices[0]?.native_finish_reason === "string" ? choices[0].native_finish_reason : null;
      if (finishReason) {
        lastFinishReason = finishReason;
      }
      if (nativeFinishReason) {
        lastNativeFinishReason = nativeFinishReason;
      }

      const delta: any = choices[0]?.delta;
      if (!delta || typeof delta !== "object") {
        warnIgnoredMalformedChunk("chunk without delta", JSON.stringify(chunk));
        continue;
      }

      let deltaContent =
        extractTextFromDeltaContent(delta?.content) ||
        (typeof delta?.text === "string" ? delta.text : "");
      const deltaReasoningFromDetails = Array.isArray(delta?.reasoning_details)
        ? delta.reasoning_details
            .map((d: any) => (typeof d?.text === "string" ? d.text : ""))
            .join("")
        : "";
      const deltaReasoning =
        (typeof delta?.reasoning_content === "string" ? delta.reasoning_content : "") ||
        (typeof delta?.thinking === "string" ? delta.thinking : "") ||
        (typeof delta?.reasoning === "string" ? delta.reasoning : "") ||
        deltaReasoningFromDetails;

      if (deltaContent && isSseCommentLine(deltaContent)) {
        warnIgnoredMalformedChunk(
          "SSE comment-like content inside delta.content",
          deltaContent
        );
        deltaContent = "";
      }

      if (debug) {
        if (deltaReasoning) {
          logMessage(`🐛 [DEBUG] [stream] delta.reasoning_content: ${deltaReasoning}`);
        }
        if (deltaContent) {
          logMessage(`🐛 [DEBUG] [stream] delta.content: ${deltaContent}`);
        }
      }

      if (deltaReasoning) {
        rawReasoningContent += deltaReasoning;
        // 在未看到任何 delta.content 的情况下，先缓冲 reasoning（可能是供应商把最终输出放错字段）
        if (!sawAnyDeltaContent) {
          reasoningOnlyBuffer += deltaReasoning;
        }
        const combinedAfterReasoning = rawAssistantContent + rawReasoningContent;
        if (
          !foundNoNeedTranslate &&
          (combinedAfterReasoning.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
            combinedAfterReasoning.includes(uuidFirstPart))
        ) {
          foundNoNeedTranslate = true;
          logMessage(`🔄 AI indicated no translation needed (in stream)`);
          break;
        }
      }

      if (deltaContent) {
        sawAnyDeltaContent = true;
        reasoningOnlyBuffer = ""; // 既然后续出现了真实 content，则丢弃之前缓冲的 reasoning，避免混入思考内容
        // If this chunk contains the special code or a fragment, only stream the safe prefix.
        const fullCodeIndex = deltaContent.indexOf(AI_RETURN_CODE.NO_NEED_TRANSLATE);
        const partialCodeIndex = deltaContent.indexOf(uuidFirstPart);
        const indexToUse =
          fullCodeIndex >= 0 && partialCodeIndex >= 0
            ? Math.min(fullCodeIndex, partialCodeIndex)
            : fullCodeIndex >= 0
              ? fullCodeIndex
              : partialCodeIndex;

        const toProcess = indexToUse >= 0 ? deltaContent.slice(0, indexToUse) : deltaContent;
        rawAssistantContent += deltaContent;
        const filtered = reasoningFilter.process(toProcess);
        if (filtered) {
          fullContent += filtered;

          // Only send content to progress callback if we're not in foundNoNeedTranslate state
          progressCallback(filtered);
        }

        if (indexToUse >= 0) {
          foundNoNeedTranslate = true;
          logMessage(`🔄 AI indicated no translation needed (in chunk)`);
          break;
        }

        // Rough estimate: 1 token ≈ 4 characters for English
        estimatedOutputTokens += Math.ceil(deltaContent.length / 4);
      }

      // Handle partial UUID occurrences that are split across chunks.
      if (!foundNoNeedTranslate) {
        const combinedSoFar = rawAssistantContent + rawReasoningContent;
        if (
          combinedSoFar.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
          combinedSoFar.includes(uuidFirstPart)
        ) {
          foundNoNeedTranslate = true;
          logMessage(`🔄 AI indicated no translation needed (in stream)`);
          break;
        }
      }
      }
    } catch (err) {
      if (inactivityAbortReason) {
        // 记录事实：触发的是“无消息超时”，不是猜测
        logMessage(`❌ ${inactivityAbortReason.message}`, "error");
        throw inactivityAbortReason;
      }
      throw err;
    } finally {
      if (idleTimer) {
        globalThis.clearTimeout(idleTimer as any);
      }
    }

    // Flush any remaining tail (if not inside a reasoning block).
    if (!foundNoNeedTranslate) {
      const flushed = reasoningFilter.flush();
      if (flushed) {
        fullContent += flushed;
        progressCallback(flushed);
        estimatedOutputTokens += Math.ceil(flushed.length / 4);
      }
    }

    // Record end time and calculate duration for streaming
    const endTime = Date.now();
    const duration = endTime - startTime;
    const shouldZeroOutputWarn = shouldWarnZeroEstimatedOutputTokens({
      estimatedOutputTokens,
      foundNoNeedTranslate,
      originalContent,
    });
    if (shouldZeroOutputWarn) {
      const facts: string[] = [];
      if (lastFinishReason) {
        facts.push(`finish_reason=${lastFinishReason}`);
      }
      if (lastNativeFinishReason && lastNativeFinishReason !== lastFinishReason) {
        facts.push(`native_finish_reason=${lastNativeFinishReason}`);
      }
      if (!sawAnyDeltaContent) {
        facts.push("未收到任何非空 delta.content");
      }
      if (rawReasoningContent.trim().length > 0) {
        facts.push(`收到 delta.reasoning*（${rawReasoningContent.length} chars）`);
      }
      if (ignoredMalformedChunkCount > 0) {
        facts.push(`忽略异常消息=${ignoredMalformedChunkCount}`);
      }

      const reason = facts.length > 0 ? facts.join("；") : "未解析到可计入输出的流式文本分片";
      logMessage(
        `⚠️ Streaming estimated output: ~0 tokens。原因：${reason}。` +
          (debug ? "（debug 已开启，可查看上方 [DEBUG] [stream] RAW/delta）" : ""),
        "warn"
      );
    }
    logMessage(
      `📥 Streaming translation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s) (estimated input: ~${estimatedInputTokens} tokens, estimated output: ~${estimatedOutputTokens} tokens)`
    );
    logMessage(`⏱️ OpenAI streaming API request total duration: ${duration}ms`);

    if (ignoredMalformedChunkCount > 5) {
      logMessage(
        `⚠️ [stream] 本次流式请求共忽略了 ${ignoredMalformedChunkCount} 条不符合数据结构的消息（为避免刷屏，仅展示部分 warn）。`,
        "warn"
      );
    }

    // Decide the final candidate:
    // - Prefer raw assistant content (delta.content/text) with reasoning stripped.
    // - Fallback to filtered streamed content (fullContent).
    // - As a last resort, if vendor put text into reasoning_content, use it to avoid empty target files.
    const stripped = stripReasoningFromModelOutput(rawAssistantContent);
    if (debug && stripped.didStrip) {
      logMessage(`🐛 [DEBUG] Stripped reasoning/thinking from streaming translation response`);
    }
    let candidate = stripped.text;
    if (candidate.trim().length === 0 && fullContent.trim().length > 0) {
      candidate = fullContent;
    }
    if (candidate.trim().length === 0 && rawReasoningContent.trim().length > 0) {
      logMessage(
        `⚠️ Streaming response had empty delta.content; falling back to delta.reasoning* fields to avoid empty translation output. This usually indicates a vendor/model streaming incompatibility.`,
        "warn"
      );
      // 优先使用 reasoningOnlyBuffer（仅在从未出现过 delta.content 时才累计），避免“先思考后输出”的场景误混入
      const reasoningToUse =
        !sawAnyDeltaContent && reasoningOnlyBuffer.trim().length > 0
          ? reasoningOnlyBuffer
          : rawReasoningContent;
      if (!sawAnyDeltaContent && reasoningOnlyBuffer.trim().length > 0) {
        logMessage(
          `⚠️ [stream] delta.content 始终为空；将使用 delta.reasoning 作为输出内容（请考虑更换模型或关闭 reasoning 输出以获得更稳定的流式 content）。`,
          "warn"
        );
      }
      const strippedReasoning = stripReasoningFromModelOutput(reasoningToUse);
      candidate =
        strippedReasoning.text.trim().length > 0
          ? strippedReasoning.text
          : reasoningToUse;
    }

    const sanitizedFullContent = sanitizeUnexpectedCodeFences(originalContent, candidate);
    if (debug && sanitizedFullContent !== candidate) {
      logMessage(`🐛 [DEBUG] Stripped unexpected code fences from streaming translation response`);
    }

    // Debug: Log complete streaming response
    if (debug) {
      logMessage(`🐛 [DEBUG] Complete Streaming Response Content:`);
      logMessage(`🐛 [DEBUG] ${sanitizedFullContent}`);
    }

    // Add estimated tokens to project total
    this.projectTotalInputTokens += estimatedInputTokens;
    this.projectTotalOutputTokens += estimatedOutputTokens;



    // Check if the response contains the full or partial UUID code
    if (
      foundNoNeedTranslate ||
      (rawAssistantContent + rawReasoningContent).includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
      (rawAssistantContent + rawReasoningContent).includes(uuidFirstPart) ||
      sanitizedFullContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
      sanitizedFullContent.includes(uuidFirstPart)
    ) {
      const parsed = this.parseNoNeedTranslateResponse(rawAssistantContent + rawReasoningContent);
      if (parsed.hasReason) {
        logMessage(
          `🔄 AI indicated no translation needed for this file. Reason: ${parsed.reason}`
        );
      } else {
        logMessage(
          `🔄 AI indicated no translation needed for this file, skipping translation`
        );
      }
      return [AI_RETURN_CODE.NO_NEED_TRANSLATE, originalContent];
    }

    return [AI_RETURN_CODE.OK, sanitizedFullContent];
  }

  private async handleRpmLimit(
    currentVendorName: string,
    rpm: number,
    cancellationToken?: CancellationTokenLike
  ): Promise<void> {
    const lastRequestTime = vendorLastRequest.get(currentVendorName) || 0;
    const now = Date.now();
    const minInterval = (60 * 1000) / rpm;
    const timeToWait = Math.max(0, minInterval - (now - lastRequestTime));

    if (timeToWait > 0) {
      logMessage(
        `⏳ Waiting for API rate limit... (${(timeToWait / 1000).toFixed(
          1
        )} seconds)`
      );

      const waitInterval = 500;
      let waitedTime = 0;
      while (waitedTime < timeToWait) {
        if (cancellationToken?.isCancellationRequested) {
          logMessage(
            "⛔ Cancel request detected, stopping API rate limit wait"
          );
          throw this.runtimeContext.createCancellationError();
        }
        await new Promise((resolve) =>
          globalThis.setTimeout(
            resolve,
            Math.min(waitInterval, timeToWait - waitedTime)
          )
        );
        waitedTime += waitInterval;
      }
    }
  }

  public getTokenCounts() {
    return {
      inputTokens: this.projectTotalInputTokens,
      outputTokens: this.projectTotalOutputTokens,
      totalTokens: this.projectTotalInputTokens + this.projectTotalOutputTokens,
    };
  }

  public resetTokenCounts() {
    this.projectTotalInputTokens = 0;
    this.projectTotalOutputTokens = 0;
  }




}
