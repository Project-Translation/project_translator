import * as vscode from 'vscode';
import { VendorConfig, SpecifiedFile, SpecifiedFolder } from '../types/types';
import * as path from 'path';
import * as fs from 'fs';

let translations: any = {};

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
}

export function getConfiguration() {
    const config = vscode.workspace.getConfiguration("projectTranslator");
    const ignoreTranslationExtensions = config.get<string[]>("ignoreTranslationExtensions") || [];
    const currentVendorName = config.get<string>("currentVendor") || "openai";
    const vendors = config.get<VendorConfig[]>("vendors") || [];
    const specifiedFiles = config.get<SpecifiedFile[]>("specifiedFiles");
    const specifiedFolders = config.get<SpecifiedFolder[]>("specifiedFolders");

    // Find current vendor configuration
    const currentVendor = vendors.find(
        (vendor) => vendor.name === currentVendorName
    );
    if (!currentVendor || !currentVendor.apiKey) {
        throw new Error(translations["error.invalidApiSettings"] || "Please provide valid API settings in the vendor configuration");
    }

    return {
        ...currentVendor,
        ignoreTranslationExtensions,
        currentVendorName,
        specifiedFiles,
        specifiedFolders,
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