import * as vscode from "vscode";
import OpenAI from "openai";
import { getConfiguration } from "../config/config";
import { SupportedLanguage } from "../translationDatabase";
import { logMessage } from "../extension";
import { DiffApplyRequest, DiffApplyResponse } from "../types/types";
import * as path from "path";
import * as fs from "fs";

// Store the last request timestamp for each vendor
const vendorLastRequest: Map<string, number> = new Map();

// AI return code.
export const AI_RETURN_CODE = {
  OK: "OK",
  NO_NEED_TRANSLATE: "727d2eb8-8683-42bd-a1d0-f604fcd82163",
};

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

  public initializeOpenAIClient() {
    const { currentVendor } = getConfiguration();
    const { apiEndpoint, apiKey, model, timeout } = currentVendor;
    if (!apiKey) {
      logMessage(
        "❌ API key is not set in the vendor configuration"
      );
      throw new Error("API key is not set in the vendor configuration");
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
      apiKey,
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
    isDiffTranslation: boolean = false
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      const error = "OpenAI client not initialized";
      logMessage(`❌ ${error}`);
      throw new Error(error);
    }

    const { currentVendorName, currentVendor, systemPrompts, userPrompts } =
      getConfiguration();
    const { model, rpm, temperature, streamMode } = currentVendor;

    logMessage(`🤖 Using model: ${model}`);
    logMessage(`🌐 Target language: ${targetLang}`);
    logMessage(`🎲 Temperature: ${temperature}`);

    if (streamMode) {
      logMessage(`🔄 Stream mode enabled`);
    } // Wait for RPM limit if needed
    if (rpm && rpm > 0) {
      await this.handleRpmLimit(currentVendorName, rpm, cancellationToken);
    }

    // merge systemPrompts
    let mergedSystemPrompt = "";
    if (systemPrompts && systemPrompts.length > 0) {
      mergedSystemPrompt = systemPrompts.join("\n");
    }
    const messages = [
      {
        role: "system" as const,
        content: mergedSystemPrompt,
      },
      ...(userPrompts || []).map((prompt: string) => ({
        role: "user" as const,
        content: prompt,
      })),
      {
        role: "user" as const,
        content: `Please translate the following content from ${sourceLang} to ${targetLang}. The file type is ${path.extname(
          sourcePath
        )}.`,
      },
      {
        role: "user" as const,
        content: content,
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
          isDiffTranslation,
          sourcePath
        );
      } else {
        return await this.standardTranslateContent(
          messages,
          model || "",
          temperature,
          currentVendorName,
          content,
          isDiffTranslation,
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

  private async standardTranslateContent(
    messages: Array<{ role: string; content: string }>,
    model: string,
    temperature: number | undefined,
    currentVendorName: string,
    originalContent: string,
    isDiffTranslation: boolean = false,
    sourcePath: string = ""
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    // Get debug configuration
    const { debug } = getConfiguration();
    
    // Record start time for API request
    const startTime = Date.now();
    logMessage(`⏱️ Starting OpenAI API request at ${new Date(startTime).toISOString()}`);

    const { currentVendor } = getConfiguration();
    const { top_p } = currentVendor;

    const requestPayload: any = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
    };

    // Add top_p to request if it's set
    if (top_p !== undefined) {
      requestPayload.top_p = top_p;
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

    // Save raw response for diff translation if needed
    if (isDiffTranslation && sourcePath) {
      await this.saveDiffRawResponse(currentVendorName, sourcePath, response);
    }

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
    isDiffTranslation: boolean = false,
    sourcePath: string = ""
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    // Get debug configuration
    const { debug } = getConfiguration();
    
    logMessage(`🔄 Starting streaming translation...`);
    let fullContent = "";
    let foundNoNeedTranslate = false;

    // Extract the first part of the UUID to detect partial occurrences
    const uuidFirstPart = AI_RETURN_CODE.NO_NEED_TRANSLATE.substring(0, 20);

    // Record start time for streaming API request
    const startTime = Date.now();
    logMessage(`⏱️ Starting OpenAI streaming API request at ${new Date(startTime).toISOString()}`);

    const { currentVendor } = getConfiguration();
    const { top_p } = currentVendor;

    const requestPayload: any = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
      stream: true,
    };

    // Add top_p to request if it's set
    if (top_p !== undefined) {
      requestPayload.top_p = top_p;
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
    let rawStreamChunks: any[] = []; // Store raw chunks for diff translation

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

      // Store raw chunk for diff translation if needed
      if (isDiffTranslation) {
        rawStreamChunks.push(chunk);
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
      if (rawStreamChunks.length > 0) {
        logMessage(`🐛 [DEBUG] Total Stream Chunks: ${rawStreamChunks.length}`);
      }
    }

    // Add estimated tokens to project total
    this.projectTotalInputTokens += estimatedInputTokens;
    this.projectTotalOutputTokens += estimatedOutputTokens;

    // Save raw response for diff translation if needed
    if (isDiffTranslation && sourcePath && rawStreamChunks.length > 0) {
      await this.saveDiffRawStreamResponse(currentVendorName, sourcePath, rawStreamChunks, fullContent);
    }

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

  /**
   * Save raw OpenAI API response for differential translation
   */
  private async saveDiffRawResponse(
    vendorName: string,
    sourcePath: string,
    response: OpenAI.Chat.Completions.ChatCompletion
  ): Promise<void> {
    if (!this.workspaceRoot) {
      return;
    }

    try {
      const cacheDir = path.join(this.workspaceRoot, ".translation-cache");
      
      // Ensure cache directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Generate filename: {vendor_name}_diff_resp_{filename}
      const sourceFileName = path.basename(sourcePath, path.extname(sourcePath));
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${vendorName}_diff_resp_${sourceFileName}_${timestamp}.json`;
      const filePath = path.join(cacheDir, fileName);

      // Save the raw response
      const responseData = {
        timestamp: new Date().toISOString(),
        sourcePath: sourcePath,
        vendorName: vendorName,
        model: response.model,
        usage: response.usage,
        response: response
      };

      fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2), "utf8");
      logMessage(`💾 Saved diff raw response to: ${fileName}`);
    } catch (error) {
      logMessage(`⚠️ Failed to save diff raw response: ${error}`);
    }
  }

  /**
   * Save raw OpenAI streaming API response for differential translation
   */
  private async saveDiffRawStreamResponse(
    vendorName: string,
    sourcePath: string,
    rawChunks: any[],
    fullContent: string
  ): Promise<void> {
    if (!this.workspaceRoot) {
      return;
    }

    try {
      const cacheDir = path.join(this.workspaceRoot, ".translation-cache");
      
      // Ensure cache directory exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
      }

      // Generate filename: {vendor_name}_diff_resp_{filename}
      const sourceFileName = path.basename(sourcePath, path.extname(sourcePath));
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `${vendorName}_diff_resp_${sourceFileName}_${timestamp}.json`;
      const filePath = path.join(cacheDir, fileName);

      // Save the raw streaming response
      const responseData = {
        timestamp: new Date().toISOString(),
        sourcePath: sourcePath,
        vendorName: vendorName,
        streamMode: true,
        fullContent: fullContent,
        rawChunks: rawChunks
      };

      fs.writeFileSync(filePath, JSON.stringify(responseData, null, 2), "utf8");
      logMessage(`💾 Saved diff stream raw response to: ${fileName}`);
    } catch (error) {
      logMessage(`⚠️ Failed to save diff stream raw response: ${error}`);
    }
  }

  /**
   * Perform diff apply translation
   */
  public async translateWithDiffApply(
    request: DiffApplyRequest,
    cancellationToken?: vscode.CancellationToken,
    progressCallback?: TranslationProgressCallback
  ): Promise<[string, DiffApplyResponse]> {
    if (!this.openaiClient) {
      const error = "OpenAI client not initialized";
      logMessage(`❌ ${error}`);
      throw new Error(error);
    }

    const { currentVendorName, currentVendor } = getConfiguration();
    const { model, rpm, temperature, streamMode } = currentVendor;

    logMessage(`🤖 Using diff apply translation with model: ${model}`);
    logMessage(`🌐 Source: ${request.source_language} → Target: ${request.target_language}`);

    // Wait for RPM limit if needed
    if (rpm && rpm > 0) {
      await this.handleRpmLimit(currentVendorName, rpm, cancellationToken);
    }

    // Load diff apply system prompt
    const diffApplyPrompt = await this.loadDiffApplyPrompt();
    
    const messages = [
      {
        role: "system" as const,
        content: diffApplyPrompt,
      },
      {
        role: "user" as const,
        content: `Please analyze the following documents and generate diff operations to update the target document.

Source Language: ${request.source_language}
Target Language: ${request.target_language}

Source Document (${request.source_document.path}):
\`\`\`
${request.source_document.content}
\`\`\`

Target Document (${request.target_document.path}):
\`\`\`
${request.target_document.content}
\`\`\`

Please return a JSON response with the diff operations needed to update the target document.`,
      },
    ];

    try {
      logMessage("📤 Sending diff apply translation request...");

      // Use stream mode if enabled and progressCallback is provided
      if (streamMode && progressCallback) {
        return await this.streamDiffApplyTranslation(
          messages,
          model || "",
          temperature,
          currentVendorName,
          progressCallback,
          cancellationToken
        );
      } else {
        return await this.standardDiffApplyTranslation(
          messages,
          model || "",
          temperature,
          currentVendorName
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logMessage(`❌ Diff apply translation failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Standard diff apply translation
   */
  private async standardDiffApplyTranslation(
    messages: Array<{ role: string; content: string }>,
    model: string,
    temperature: number | undefined,
    currentVendorName: string
  ): Promise<[string, DiffApplyResponse]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const { debug } = getConfiguration();
    const startTime = Date.now();
    logMessage(`⏱️ Starting diff apply API request at ${new Date(startTime).toISOString()}`);

    const { currentVendor } = getConfiguration();
    const { top_p } = currentVendor;

    const requestPayload: any = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
    };

    // Add top_p to request if it's set
    if (top_p !== undefined) {
      requestPayload.top_p = top_p;
    }

    if (debug) {
      logMessage(`🐛 [DEBUG] Diff Apply API Request:`);
      logMessage(`🐛 [DEBUG] ${JSON.stringify(requestPayload, null, 2)}`);
    }

    const response = await this.openaiClient.chat.completions.create(requestPayload);

    const endTime = Date.now();
    const duration = endTime - startTime;
    logMessage(`⏱️ Diff apply API request completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

    if (debug) {
      logMessage(`🐛 [DEBUG] Diff Apply API Response:`);
      logMessage(`🐛 [DEBUG] ${JSON.stringify(response, null, 2)}`);
    }

    vendorLastRequest.set(currentVendorName, Date.now());

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    logMessage(
      `📥 Diff apply request completed (input: ${inputTokens} tokens, output: ${outputTokens} tokens)`
    );

    this.projectTotalInputTokens += inputTokens;
    this.projectTotalOutputTokens += outputTokens;

    const rawResponse = response.choices[0]?.message?.content || "";
    
    // Parse the response to extract diff operations
    const diffResponse = this.parseDiffApplyResponse(rawResponse);
    
    return [AI_RETURN_CODE.OK, diffResponse];
  }

  /**
   * Stream diff apply translation
   */
  private async streamDiffApplyTranslation(
    messages: Array<{ role: string; content: string }>,
    model: string,
    temperature: number | undefined,
    currentVendorName: string,
    progressCallback: TranslationProgressCallback,
    cancellationToken?: vscode.CancellationToken
  ): Promise<[string, DiffApplyResponse]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const { debug } = getConfiguration();
    logMessage(`🔄 Starting streaming diff apply translation...`);
    let fullContent = "";

    const startTime = Date.now();
    logMessage(`⏱️ Starting diff apply streaming API request at ${new Date(startTime).toISOString()}`);

    const { currentVendor } = getConfiguration();
    const { top_p } = currentVendor;

    const requestPayload: any = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
      stream: true,
    };

    // Add top_p to request if it's set
    if (top_p !== undefined) {
      requestPayload.top_p = top_p;
    }

    if (debug) {
      logMessage(`🐛 [DEBUG] Diff Apply Streaming API Request:`);
      logMessage(`🐛 [DEBUG] ${JSON.stringify(requestPayload, null, 2)}`);
    }

    const stream = await this.openaiClient.chat.completions.create(requestPayload) as any;
    vendorLastRequest.set(currentVendorName, Date.now());

    let estimatedInputTokens = 0;
    let estimatedOutputTokens = 0;

    // Estimate input tokens
    for (const message of messages) {
      estimatedInputTokens += Math.ceil(message.content.length / 4);
    }

    for await (const chunk of stream) {
      if (cancellationToken?.isCancellationRequested) {
        logMessage("⛔ Diff apply translation cancelled");
        throw new vscode.CancellationError();
      }

      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        fullContent += content;
        progressCallback(content);
        estimatedOutputTokens += Math.ceil(content.length / 4);
      }
    }

    const endTime = Date.now();
    const duration = endTime - startTime;
    logMessage(
      `📥 Streaming diff apply translation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s) (estimated input: ~${estimatedInputTokens} tokens, estimated output: ~${estimatedOutputTokens} tokens)`
    );

    if (debug) {
      logMessage(`🐛 [DEBUG] Complete Diff Apply Streaming Response:`);
      logMessage(`🐛 [DEBUG] ${fullContent}`);
    }

    this.projectTotalInputTokens += estimatedInputTokens;
    this.projectTotalOutputTokens += estimatedOutputTokens;

    // Parse the response to extract diff operations
    const diffResponse = this.parseDiffApplyResponse(fullContent);
    
    return [AI_RETURN_CODE.OK, diffResponse];
  }

  /**
   * Parse AI response to extract diff operations
   */
  private parseDiffApplyResponse(aiResponse: string): DiffApplyResponse {
    try {
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          status: 'error',
          error_message: 'No valid JSON found in AI response'
        };
      }

      const parsed = JSON.parse(jsonMatch[0]) as DiffApplyResponse;
      
      // Basic validation
      if (!parsed.status || !['success', 'error', 'no_changes'].includes(parsed.status)) {
        return {
          status: 'error',
          error_message: 'Invalid response status from AI'
        };
      }

      return parsed;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        status: 'error',
        error_message: `Failed to parse AI response: ${errorMessage}`
      };
    }
  }

  /**
   * Load diff apply system prompt
   */
  private async loadDiffApplyPrompt(): Promise<string> {
    try {
      const promptPath = path.join(__dirname, '../../prompts/diff-apply-system-prompt.md');
      if (fs.existsSync(promptPath)) {
        return fs.readFileSync(promptPath, 'utf-8');
      } else {
        // Fallback to embedded prompt
        return this.getDefaultDiffApplyPrompt();
      }
    } catch (error) {
      logMessage(`⚠️ Failed to load diff apply prompt, using default: ${error}`);
      return this.getDefaultDiffApplyPrompt();
    }
  }

  /**
   * Get default diff apply prompt
   */
  private getDefaultDiffApplyPrompt(): string {
    return `你是一个专业的文档差异分析和翻译AI。你的任务是比较源语言文档和目标语言文档，识别需要更新的部分，并生成精确的操作指令。

## 输出格式要求

你必须返回有效的JSON格式，结构如下：

{
  "status": "success|error|no_changes",
  "operations": [
    {
      "type": "update|insert|delete",
      "line_number": 数字,
      "old_content": "原内容(仅update操作需要)",
      "new_content": "新内容(仅update操作需要)",
      "content": "内容(仅insert/delete操作需要)"
    }
  ],
  "metadata": {
    "total_operations": 数字,
    "estimated_changes": "minor|major|extensive"
  }
}

## 操作类型说明

1. update: 修改现有行的内容
2. insert: 插入新的行
3. delete: 删除现有行

确保操作的准确性和原子性。`;
  }
}
