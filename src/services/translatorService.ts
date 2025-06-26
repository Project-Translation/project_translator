import * as vscode from "vscode";
import OpenAI from "openai";
import { getConfiguration } from "../config/config";
import { SupportedLanguage } from "../translationDatabase";
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
      this.outputChannel.appendLine(
        "❌ API key is not set in the vendor configuration"
      );
      throw new Error("API key is not set in the vendor configuration");
    }
    if (!apiEndpoint) {
      this.outputChannel.appendLine(
        "❌ API endpoint is not set in the vendor configuration"
      );
      throw new Error("API endpoint is not set in the vendor configuration");
    }
    if (!model) {
      this.outputChannel.appendLine(
        "❌ Model is not set in the vendor configuration"
      );
      throw new Error("Model is not set in the vendor configuration");
    }

    this.outputChannel.appendLine(
      `🔑 Using vendor API endpoint: ${apiEndpoint}`
    );
    const config: ConstructorParameters<typeof OpenAI>[0] = {
      apiKey,
      baseURL: apiEndpoint,
    };

    const timeoutMs = timeout ? timeout * 1000 : 30000;
    this.outputChannel.appendLine(
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
      this.outputChannel.appendLine(`❌ ${error}`);
      throw new Error(error);
    }

    const { currentVendorName, currentVendor, systemPrompts, userPrompts } =
      getConfiguration();
    const { model, rpm, temperature, streamMode } = currentVendor;

    this.outputChannel.appendLine(`🤖 Using model: ${model}`);
    this.outputChannel.appendLine(`🌐 Target language: ${targetLang}`);
    this.outputChannel.appendLine(`🎲 Temperature: ${temperature}`);

    if (streamMode) {
      this.outputChannel.appendLine(`🔄 Stream mode enabled`);
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
      this.outputChannel.appendLine("📤 Sending translation request...");

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
      this.outputChannel.appendLine(`❌ Translation failed: ${errorMessage}`);
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
    this.outputChannel.appendLine(`⏱️ Starting OpenAI API request at ${new Date(startTime).toISOString()}`);

    const requestPayload = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
    };

    // Debug: Log request payload
    if (debug) {
      this.outputChannel.appendLine(`🐛 [DEBUG] OpenAI API Request:`);
      this.outputChannel.appendLine(`🐛 [DEBUG] ${JSON.stringify(requestPayload, null, 2)}`);
    }

    const response = await this.openaiClient.chat.completions.create(requestPayload);

    // Record end time and calculate duration
    const endTime = Date.now();
    const duration = endTime - startTime;
    this.outputChannel.appendLine(`⏱️ OpenAI API request completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);

    // Debug: Log response
    if (debug) {
      this.outputChannel.appendLine(`🐛 [DEBUG] OpenAI API Response:`);
      this.outputChannel.appendLine(`🐛 [DEBUG] ${JSON.stringify(response, null, 2)}`);
    }

    // Update the timestamp regardless of translation status
    vendorLastRequest.set(currentVendorName, Date.now());

    const inputTokens = response.usage?.prompt_tokens || 0;
    const outputTokens = response.usage?.completion_tokens || 0;
    this.outputChannel.appendLine(
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
      this.outputChannel.appendLine(
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
    
    this.outputChannel.appendLine(`🔄 Starting streaming translation...`);
    let fullContent = "";
    let foundNoNeedTranslate = false;

    // Extract the first part of the UUID to detect partial occurrences
    const uuidFirstPart = AI_RETURN_CODE.NO_NEED_TRANSLATE.substring(0, 20);

    // Record start time for streaming API request
    const startTime = Date.now();
    this.outputChannel.appendLine(`⏱️ Starting OpenAI streaming API request at ${new Date(startTime).toISOString()}`);

    const requestPayload = {
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
      stream: true,
    };

    // Debug: Log request payload
    if (debug) {
      this.outputChannel.appendLine(`🐛 [DEBUG] OpenAI Streaming API Request:`);
      this.outputChannel.appendLine(`🐛 [DEBUG] ${JSON.stringify(requestPayload, null, 2)}`);
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
        this.outputChannel.appendLine("⛔ Translation cancelled");
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
          this.outputChannel.appendLine(
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
            this.outputChannel.appendLine(
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
    this.outputChannel.appendLine(
      `📥 Streaming translation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s) (estimated input: ~${estimatedInputTokens} tokens, estimated output: ~${estimatedOutputTokens} tokens)`
    );
    this.outputChannel.appendLine(`⏱️ OpenAI streaming API request total duration: ${duration}ms`);

    // Debug: Log complete streaming response
    if (debug) {
      this.outputChannel.appendLine(`🐛 [DEBUG] Complete Streaming Response Content:`);
      this.outputChannel.appendLine(`🐛 [DEBUG] ${fullContent}`);
      if (rawStreamChunks.length > 0) {
        this.outputChannel.appendLine(`🐛 [DEBUG] Total Stream Chunks: ${rawStreamChunks.length}`);
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
      this.outputChannel.appendLine(
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
      this.outputChannel.appendLine(
        `⏳ Waiting for API rate limit... (${(timeToWait / 1000).toFixed(
          1
        )} seconds)`
      );

      const waitInterval = 500;
      let waitedTime = 0;
      while (waitedTime < timeToWait) {
        if (cancellationToken?.isCancellationRequested) {
          this.outputChannel.appendLine(
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
      this.outputChannel.appendLine(`💾 Saved diff raw response to: ${fileName}`);
    } catch (error) {
      this.outputChannel.appendLine(`⚠️ Failed to save diff raw response: ${error}`);
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
      this.outputChannel.appendLine(`💾 Saved diff stream raw response to: ${fileName}`);
    } catch (error) {
      this.outputChannel.appendLine(`⚠️ Failed to save diff stream raw response: ${error}`);
    }
  }
}
