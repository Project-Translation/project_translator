import * as vscode from "vscode";
import OpenAI from "openai";
import { getConfiguration } from "../config/config";
import { SupportedLanguage } from "../translationDatabase";
import * as path from "path";

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

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
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
    progressCallback?: TranslationProgressCallback
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
          cancellationToken
        );
      } else {
        return await this.standardTranslateContent(
          messages,
          model || "",
          temperature,
          currentVendorName,
          content
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
    originalContent: string
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    const response = await this.openaiClient.chat.completions.create({
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
    });

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
    cancellationToken?: vscode.CancellationToken
  ): Promise<[string, string]> {
    if (!this.openaiClient) {
      throw new Error("OpenAI client not initialized");
    }

    this.outputChannel.appendLine(`🔄 Starting streaming translation...`);
    let fullContent = "";
    let foundNoNeedTranslate = false;

    // Extract the first part of the UUID to detect partial occurrences
    const uuidFirstPart = AI_RETURN_CODE.NO_NEED_TRANSLATE.substring(0, 20);

    const stream = await this.openaiClient.chat.completions.create({
      model: model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      temperature: temperature,
      stream: true,
    });

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
        this.outputChannel.appendLine("⛔ Translation cancelled");
        throw new vscode.CancellationError();
      }

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

    this.outputChannel.appendLine(
      `📥 Streaming translation completed (estimated input: ~${estimatedInputTokens} tokens, estimated output: ~${estimatedOutputTokens} tokens)`
    );

    // Add estimated tokens to project total
    this.projectTotalInputTokens += estimatedInputTokens;
    this.projectTotalOutputTokens += estimatedOutputTokens;

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
}
