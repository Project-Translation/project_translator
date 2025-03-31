import * as vscode from 'vscode';
import OpenAI from 'openai';
import { getConfiguration, getTranslationPrompts } from '../config/config';
import { SupportedLanguage } from '../translationDatabase';
import * as path from 'path';

// Store the last request timestamp for each vendor
const vendorLastRequest: Map<string, number> = new Map();

// AI return code.
export const AI_RETURN_CODE = {
    OK: "OK",
    NO_NEED_TRANSLATE: "727d2eb8-8683-42bd-a1d0-f604fcd82163"
};

export class TranslatorService {
    private openaiClient: OpenAI | null = null;
    private outputChannel: vscode.OutputChannel;
    private projectTotalInputTokens = 0;
    private projectTotalOutputTokens = 0;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    public initializeOpenAIClient() {
        const { apiEndpoint, apiKey, model, timeout } = getConfiguration();
        this.outputChannel.appendLine(`🔑 Using vendor API endpoint: ${apiEndpoint}`);
        const config: ConstructorParameters<typeof OpenAI>[0] = {
            apiKey,
            baseURL: apiEndpoint,
        };

        const timeoutMs = timeout ? timeout * 1000 : 30000;
        this.outputChannel.appendLine(`⏱️ API request timeout setting: ${timeout || 30} seconds (${timeoutMs}ms)`);
        config.timeout = timeoutMs;

        this.openaiClient = new OpenAI(config);
        return { model };
    }

    public async translateContent(
        content: string,
        sourceLang: SupportedLanguage,
        targetLang: SupportedLanguage,
        sourcePath: string,
        cancellationToken?: vscode.CancellationToken
    ): Promise<[string, string]> {
        if (!this.openaiClient) {
            const error = "OpenAI client not initialized";
            this.outputChannel.appendLine(`❌ ${error}`);
            throw new Error(error);
        }

        const config = getConfiguration();
        const { model, currentVendorName, rpm, temperature } = config;

        this.outputChannel.appendLine(`🤖 Using model: ${model}`);
        this.outputChannel.appendLine(`🌐 Target language: ${targetLang}`);
        this.outputChannel.appendLine(`🎲 Temperature: ${temperature}`);

        // Wait for RPM limit if needed
        if (rpm && rpm > 0) {
            await this.handleRpmLimit(currentVendorName, rpm, cancellationToken);
        }

        try {
            const { systemPrompts, userPrompts } = getTranslationPrompts();

            this.outputChannel.appendLine("📤 Sending translation request...");
            const response = await this.openaiClient.chat.completions.create({
                model: model || "",
                messages: [
                    ...systemPrompts.map(prompt => ({
                        role: "system" as const,
                        content: prompt,
                    })),
                    ...(systemPrompts.length === 0 ? [{
                        role: "system" as const,
                        content: "",
                    }] : []),
                    ...userPrompts.map((prompt) => ({
                        role: "user" as const,
                        content: prompt,
                    })),
                    {
                        role: "user",
                        content: `Please translate the following content from ${sourceLang} to ${targetLang}. The file type is ${path.extname(sourcePath)}.`,
                    },
                    {
                        role: "user",
                        content: content,
                    },
                ],
                temperature: temperature
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

            const translatedContent = response.choices[0]?.message?.content || content;
            
            // Check if the response contains the NO_NEED_TRANSLATE return code
            if (translatedContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE)) {
                this.outputChannel.appendLine(`🔄 AI indicated no translation needed for this file, skipping translation`);
                return [AI_RETURN_CODE.NO_NEED_TRANSLATE, content]; // Return the original content unchanged
            }

            return [AI_RETURN_CODE.OK, translatedContent];
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.outputChannel.appendLine(`❌ Translation failed: ${errorMessage}`);
            throw error;
        }
    }

    private async handleRpmLimit(currentVendorName: string, rpm: number, cancellationToken?: vscode.CancellationToken): Promise<void> {
        const lastRequestTime = vendorLastRequest.get(currentVendorName) || 0;
        const now = Date.now();
        const minInterval = (60 * 1000) / rpm;
        const timeToWait = Math.max(0, minInterval - (now - lastRequestTime));

        if (timeToWait > 0) {
            this.outputChannel.appendLine(
                `⏳ Waiting for API rate limit... (${(timeToWait / 1000).toFixed(1)} seconds)`
            );

            const waitInterval = 500;
            let waitedTime = 0;
            while (waitedTime < timeToWait) {
                if (cancellationToken?.isCancellationRequested) {
                    this.outputChannel.appendLine("⛔ Cancel request detected, stopping API rate limit wait");
                    throw new vscode.CancellationError();
                }
                await new Promise((resolve) =>
                    globalThis.setTimeout(resolve, Math.min(waitInterval, timeToWait - waitedTime))
                );
                waitedTime += waitInterval;
            }
        }
    }

    public getTokenCounts() {
        return {
            inputTokens: this.projectTotalInputTokens,
            outputTokens: this.projectTotalOutputTokens,
            totalTokens: this.projectTotalInputTokens + this.projectTotalOutputTokens
        };
    }

    public resetTokenCounts() {
        this.projectTotalInputTokens = 0;
        this.projectTotalOutputTokens = 0;
    }
}