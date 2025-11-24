import * as vscode from "vscode";
import OpenAI from "openai";
import { getConfiguration } from "../config/config";
import { SupportedLanguage } from "../translationDatabase";
import { logMessage } from "../extension";
import * as path from "path";
import { AI_RETURN_CODE, DIFF_SYSTEM_PROMPT, getDiffSystemPrompt } from "../config/prompt";
// no fs usage here

// Store the last request timestamp for each vendor
const vendorLastRequest: Map<string, number> = new Map();

// AI return codes are now imported from prompt.js

export interface TranslationProgressCallback {
  (chunk: string): void;
}

export class TranslatorService {
  private openaiClient: OpenAI | null = null;
  private outputChannel: vscode.OutputChannel;
  private projectTotalInputTokens = 0;
  private projectTotalOutputTokens = 0;
  private workspaceRoot: string | null = null;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    // Get workspace root for saving diff responses
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
      this.workspaceRoot = workspaceFolders[0].uri.fsPath;
    }
  }

  public async initializeOpenAIClient() {
    const { currentVendor } = await getConfiguration();
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
        "❌ API key is not set in the vendor configuration or environment variable"
      );
      throw new Error("API key is not set in the vendor configuration or environment variable");
    }
    
    if (!apiEndpoint) {
      logMessage(
        "❌ API endpoint is not set in the vendor configuration"
      );
      throw new Error("API endpoint is not set in the vendor configuration");
    }
    if (!model) {
      logMessage(
        "❌ Model is not set in the vendor configuration"
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

    const timeoutMs = timeout ? timeout * 1000 : 30000;
    logMessage(
      `⏱️ API request timeout setting: ${
        timeout || 30
      } seconds (${timeoutMs}ms)`
    );
    config.timeout = timeoutMs;

    this.openaiClient = new OpenAI(config);
  }

  public async translateContent(
    content: string,
    sourceLang: SupportedLanguage,
    targetLang: SupportedLanguage,
    sourcePath: string,
    cancellationToken?: vscode.CancellationToken,
    progressCallback?: TranslationProgressCallback,
    isFirstSegment: boolean = true // Add parameter to indicate if this is the first segment
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      const error = "OpenAI client not initialized";
      logMessage(`❌ ${error}`);
      throw new Error(error);
    }

    const config = await getConfiguration();
    const { currentVendorName, currentVendor, systemPrompts, userPrompts } = config;
    const debug = !!config.debug;
    // Ensure temperature has a sensible default if undefined
    const { model, rpm, streamMode } = currentVendor;
    const temperature = currentVendor.temperature === undefined ? 0.7 : currentVendor.temperature;

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
    let effectiveSystemPrompts: string[];
    if (isFirstSegment && systemPrompts && systemPrompts.length >= 2) {
      // For the first segment, use both parts of the system prompt
      effectiveSystemPrompts = systemPrompts;
    } else if (systemPrompts && systemPrompts.length > 0) {
      // For subsequent segments or when only one prompt is available, use only the first part
      effectiveSystemPrompts = [systemPrompts[0]];
    } else {
      // Fallback to empty array if no prompts are available
      effectiveSystemPrompts = [];
    }

    // merge systemPrompts
    let mergedSystemPrompt = "";
    if (effectiveSystemPrompts.length > 0) {
      mergedSystemPrompt = effectiveSystemPrompts.join("\n");
    }
    // Message ordering per requirement:
    // 1) system: system prompts
    // 2) user: raw content
    // 3) user custom prompts from settings
    // 4) built-in user prompt(s)
    const messages = [
      {
        role: "system" as const,
        content: mergedSystemPrompt,
      },
      {
        role: "user" as const,
        content: content,
      },
      ...(userPrompts || []).map((prompt: string) => ({
        role: "user" as const,
        content: prompt,
      })),
      {
        role: "user" as const,
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
          sourcePath
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
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logMessage(`❌ Translation failed: ${errorMessage}`);
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
      logMessage(`❌ ${error}`);
      throw new Error(error);
    }

    const config = await getConfiguration();
    const { currentVendorName, currentVendor, systemPrompts, userPrompts } = config;

    const mergedSystemPrompt = [
      ...(systemPrompts || []),
      DIFF_SYSTEM_PROMPT
    ].join("\n");

    const messages = [
      { role: "system" as const, content: mergedSystemPrompt },
      {
        role: "system" as const,
        content: getDiffSystemPrompt(sourceLang, targetLang, sourcePath),
      },
      // 先提供 SOURCE 后提供 TARGET，便于模型对齐
      { role: "user" as const, content: `SOURCE BEGIN\n${sourceContent}\nSOURCE END` },
      { role: "user" as const, content: `TARGET BEGIN\n${targetContent}\nTARGET END` },
      // User custom prompts last
      ...(userPrompts || []).map((p) => ({ role: "user" as const, content: p })),
    ];

    logMessage(`🔄 Sending differential translation request...`);
    logMessage(`🔄 Messages: ${JSON.stringify(messages, null, 2)}`);

    const payload: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: currentVendor.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: currentVendor.temperature,
      top_p: currentVendor.top_p,
    };

    const response = await this.openaiClient.chat.completions.create(payload);
    vendorLastRequest.set(currentVendorName, Date.now());
    const content = response.choices?.[0]?.message?.content?.trim() || '';
    return content;
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
      response.choices[0]?.message?.content || originalContent;



    // Check if the response contains the NO_NEED_TRANSLATE return code
    if (translatedContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE)) {
      logMessage(
        `🔄 AI indicated no translation needed for this file, skipping translation`
      );
      return [AI_RETURN_CODE.NO_NEED_TRANSLATE, originalContent]; // Return the original content unchanged
    }

    return [AI_RETURN_CODE.OK, translatedContent];
  }

  private async streamTranslateContent(
    messages: Array<{ role: string; content: string }>,
    model: string,
    temperature: number | undefined,
    currentVendorName: string,
    originalContent: string,
    progressCallback: TranslationProgressCallback,
    cancellationToken?: vscode.CancellationToken,
    debug: boolean | undefined = false,
    topP: number | undefined = undefined,
    sourcePath: string = ""
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    logMessage(`🔄 Starting streaming translation...`);
    let fullContent = "";
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

    const stream = await this.openaiClient.chat.completions.create(requestPayload) as any;

    // Update request timestamp at the start of streaming
    vendorLastRequest.set(currentVendorName, Date.now());

    // Initialize token counters - this is an estimate since the streaming API doesn't provide token counts
    let estimatedInputTokens = 0;
    let estimatedOutputTokens = 0;


    // Estimate input tokens based on input messages
    for (const message of messages) {
      // Rough estimate: 1 token ≈ 4 characters for English
      estimatedInputTokens += Math.ceil(message.content.length / 4);
    }

    for await (const chunk of stream) {
      if (cancellationToken?.isCancellationRequested) {
        logMessage("⛔ Translation cancelled");
        throw new vscode.CancellationError();
      }

      

      // Debug: Log each chunk (disabled in stream mode when debug is enabled)
      // Stream Chunk logging is intentionally disabled in debug mode to reduce noise

      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        // Add to full content for later analysis
        fullContent += content;

        // Check if the accumulated response contains the full or partial UUID code
        if (
          !foundNoNeedTranslate &&
          (fullContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
            fullContent.includes(uuidFirstPart))
        ) {
          foundNoNeedTranslate = true;
          logMessage(
            `🔄 AI indicated no translation needed (in stream)`
          );
          // Since NO_NEED_TRANSLATE was detected, we won't pass anything to the progress callback
          // The file will be directly copied in the FileProcessor after this method returns
          break; // Exit the loop early
        }

        if (!foundNoNeedTranslate) {
          // Check for both full UUID and any fragment of it
          if (
            !content.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) &&
            !content.includes(uuidFirstPart)
          ) {
            // Only send content to progress callback if we're not in foundNoNeedTranslate state
            progressCallback(content);
          } else {
            // If this chunk contains the special code or a fragment,
            // find the safe part before the UUID fragment
            const fullCodeIndex = content.indexOf(
              AI_RETURN_CODE.NO_NEED_TRANSLATE
            );
            const partialCodeIndex = content.indexOf(uuidFirstPart);

            // Find the earliest occurrence of any part of the UUID
            const indexToUse =
              fullCodeIndex >= 0 && partialCodeIndex >= 0
                ? Math.min(fullCodeIndex, partialCodeIndex)
                : fullCodeIndex >= 0
                ? fullCodeIndex
                : partialCodeIndex;

            // Only add content that came before the UUID if there is any
            if (indexToUse > 0) {
              progressCallback(content.substring(0, indexToUse));
            }

            foundNoNeedTranslate = true;
            logMessage(
              `🔄 AI indicated no translation needed (in chunk)`
            );
            // We'll handle the direct file copy in the FileProcessor
            break;
          }
        }

        // Rough estimate: 1 token ≈ 4 characters for English
        estimatedOutputTokens += Math.ceil(content.length / 4);
      }
    }

    // Record end time and calculate duration for streaming
    const endTime = Date.now();
    const duration = endTime - startTime;
    logMessage(
      `📥 Streaming translation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s) (estimated input: ~${estimatedInputTokens} tokens, estimated output: ~${estimatedOutputTokens} tokens)`
    );
    logMessage(`⏱️ OpenAI streaming API request total duration: ${duration}ms`);

    // Debug: Log complete streaming response
    if (debug) {
      logMessage(`🐛 [DEBUG] Complete Streaming Response Content:`);
      logMessage(`🐛 [DEBUG] ${fullContent}`);
    }

    // Add estimated tokens to project total
    this.projectTotalInputTokens += estimatedInputTokens;
    this.projectTotalOutputTokens += estimatedOutputTokens;



    // Check if the response contains the full or partial UUID code
    if (
      foundNoNeedTranslate ||
      fullContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
      fullContent.includes(uuidFirstPart)
    ) {
      logMessage(
        `🔄 AI indicated no translation needed for this file, skipping translation`
      );
      return [AI_RETURN_CODE.NO_NEED_TRANSLATE, originalContent];
    }

    return [AI_RETURN_CODE.OK, fullContent];
  }

  private async handleRpmLimit(
    currentVendorName: string,
    rpm: number,
    cancellationToken?: vscode.CancellationToken
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
          throw new vscode.CancellationError();
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
