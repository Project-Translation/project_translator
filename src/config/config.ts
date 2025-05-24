import * as vscode from 'vscode';
import { VendorConfig, SpecifiedFile, SpecifiedFolder, CopyOnlyConfig, IgnoreConfig } from '../types/types';
import * as path from 'path';
import * as fs from 'fs';
import * as process from 'process';

// Using Record<string, string> instead of any
let translations: Record<string, string> = {};

export function loadTranslations(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration("projectTranslator");
    const language = config.get<string>("language", "en");
    const translationsPath = path.join(context.extensionPath, "i18n", `${language}.json`);
    if (fs.existsSync(translationsPath)) {
        translations = JSON.parse(fs.readFileSync(translationsPath, "utf-8"));
    }
}

export interface Config {
    specifiedFiles?: SpecifiedFile[]; // Configuration for specified files
    specifiedFolders?: SpecifiedFolder[]; // Configuration for specified folders
    copyOnly?: CopyOnlyConfig; // Configuration for copy-only files and folders
    ignore?: IgnoreConfig; // Configuration for files and folders to ignore during translation
    currentVendorName: string; // Name of the current vendor
    vendors: VendorConfig[]; // List of vendor configurations
    translationIntervalDays: number; // Interval for translation in days
    currentVendor: VendorConfig; // Current vendor configuration
    systemPrompts?: string[]; // System prompts for translation
    userPrompts?: string[]; // User prompts for translation
}

export function getConfiguration(): Config {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const configFilePath = path.join(workspaceRoot, 'project_translation.json');

        if (fs.existsSync(configFilePath)) {
            try {
                const fileContent = fs.readFileSync(configFilePath, 'utf-8');
                const parsedConfig = JSON.parse(fileContent);
                
                // Ensure we include systemPrompts and userPrompts if not present in file config
                if (!parsedConfig.systemPrompts || !parsedConfig.userPrompts) {
                    const prompts = getTranslationPrompts();
                    parsedConfig.systemPrompts = parsedConfig.systemPrompts || prompts.systemPrompts;
                    parsedConfig.userPrompts = parsedConfig.userPrompts || prompts.userPrompts;
                }
                
                return parsedConfig;
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to parse project_translation.json: ${(error as Error).message}`);
            }
        }
    }

    // Fallback to VS Code settings
    const config = vscode.workspace.getConfiguration("projectTranslator");
    
    const copyOnly = config.get<CopyOnlyConfig>("copyOnly");
    const ignore = config.get<IgnoreConfig>("ignore");
    const currentVendorName = config.get<string>("currentVendor") || "openai";
    const vendors = config.get<VendorConfig[]>("vendors") || [];
    const specifiedFiles = config.get<SpecifiedFile[]>("specifiedFiles");
    const specifiedFolders = config.get<SpecifiedFolder[]>("specifiedFolders");
    const translationIntervalDays = config.get<number>("translationIntervalDays") || 1;

    // Find current vendor configuration
    const currentVendor = vendors.find(
        (vendor) => vendor.name === currentVendorName
    );
    if (!currentVendor) {
        throw new Error(translations["error.invalidApiSettings"] || "Please provide valid API settings in the vendor configuration");
    }

    // If API key is not set directly in the configuration, check environment variable
    if (!currentVendor.apiKey && currentVendor.apiKeyEnvVarName) {
        const envApiKey = process.env[currentVendor.apiKeyEnvVarName];
        if (envApiKey) {
            currentVendor.apiKey = envApiKey;
        }
    }

    // Validate that we have an API key either from settings or environment variable
    if (!currentVendor.apiKey) {
        throw new Error(translations["error.invalidApiSettings"] ||
            `Please provide valid API key in the vendor configuration or set the environment variable ${currentVendor.apiKeyEnvVarName || 'specified in apiKeyEnvVarName'}`);
    }

    // Get prompts to include in the configuration
    const prompts = getTranslationPrompts();

    return {
        copyOnly,
        ignore,
        currentVendorName,
        vendors,
        translationIntervalDays,
        specifiedFiles,
        specifiedFolders,
        currentVendor,
        systemPrompts: prompts.systemPrompts,
        userPrompts: prompts.userPrompts
    };
}

export function getTranslationPrompts() {
    const projectConfig = vscode.workspace.getConfiguration("projectTranslator");
    const systemPrompts = projectConfig.get<string[]>("systemPrompts") || [];
    const userPrompts = projectConfig.get<string[]>("userPrompts") || [];

    return {
        systemPrompts,
        userPrompts
    };
}