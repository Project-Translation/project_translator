export type JsonSchemaType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export interface JsonSchemaNode {
  $schema?: string;
  title?: string;
  description?: string;
  type?: JsonSchemaType | JsonSchemaType[];
  required?: string[];
  properties?: Record<string, JsonSchemaNode>;
  additionalProperties?: boolean | JsonSchemaNode;
  items?: JsonSchemaNode;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

const languageCodeSchema: JsonSchemaNode = {
  type: "string",
  minLength: 1,
  maxLength: 9,
};

const pathAndLanguageSchema: JsonSchemaNode = {
  type: "object",
  required: ["path", "lang"],
  properties: {
    path: { type: "string", minLength: 1 },
    lang: languageCodeSchema,
  },
  additionalProperties: false,
};

const vendorSchema: JsonSchemaNode = {
  type: "object",
  required: ["name", "apiEndpoint", "model"],
  properties: {
    name: { type: "string", minLength: 1 },
    apiEndpoint: { type: "string", minLength: 1 },
    apiKey: { type: "string" },
    apiKeyEnvVarName: { type: "string" },
    model: { type: "string", minLength: 1 },
    rpm: { type: "number", minimum: 0 },
    maxTokensPerSegment: { type: "number", minimum: 1 },
    timeout: { type: "number", minimum: 1 },
    temperature: { type: "number", minimum: 0, maximum: 2 },
    top_p: { type: "number", minimum: 0, maximum: 1 },
    streamMode: { type: "boolean" },
  },
  additionalProperties: false,
};

const skipFrontMatterSchema: JsonSchemaNode = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    markers: {
      type: "array",
      items: {
        type: "object",
        required: ["key", "value"],
        properties: {
          key: { type: "string", minLength: 1 },
          value: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

export const projectTranslationSchema: JsonSchemaNode = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "Project Translator Configuration",
  description: "Schema for project.translation.json",
  type: "object",
  required: ["currentVendor", "vendors"],
  properties: {
    $schema: { type: "string", minLength: 1 },
    currentVendor: { type: "string", minLength: 1 },
    vendors: {
      type: "array",
      minItems: 1,
      items: vendorSchema,
    },
    systemPromptLanguage: { type: "string", minLength: 1 },
    debug: { type: "boolean" },
    enableMetrics: { type: "boolean" },
    logFile: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        path: { type: "string" },
        maxSizeKB: { type: "number", minimum: 1024, maximum: 102400 },
        maxFiles: { type: "number", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    specifiedFiles: {
      type: "array",
      items: {
        type: "object",
        required: ["sourceFile", "targetFiles"],
        properties: {
          sourceFile: pathAndLanguageSchema,
          targetFiles: {
            type: "array",
            items: pathAndLanguageSchema,
          },
        },
        additionalProperties: false,
      },
    },
    specifiedFolders: {
      type: "array",
      items: {
        type: "object",
        required: ["sourceFolder", "targetFolders"],
        properties: {
          sourceFolder: pathAndLanguageSchema,
          targetFolders: {
            type: "array",
            items: pathAndLanguageSchema,
          },
        },
        additionalProperties: false,
      },
    },
    translationIntervalDays: { type: "number", minimum: -1 },
    copyOnly: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
        },
        extensions: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    ignore: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
        },
        extensions: {
          type: "array",
          items: { type: "string" },
        },
      },
      additionalProperties: false,
    },
    customPrompts: {
      type: "array",
      items: { type: "string" },
    },
    segmentationMarkers: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: { type: "string" },
      },
    },
    diffApply: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        validationLevel: {
          type: "string",
          enum: ["normal", "strict"],
        },
        autoBackup: { type: "boolean" },
        maxOperationsPerFile: { type: "number", minimum: 1, maximum: 10000 },
      },
      additionalProperties: false,
    },
    skipFrontMatterMarkers: skipFrontMatterSchema,
    // 兼容旧配置键名
    skipFrontMatter: skipFrontMatterSchema,
    // 兼容旧提示词字段
    systemPrompts: {
      type: "array",
      items: { type: "string" },
    },
    userPrompts: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
};

export function getProjectTranslationSchema(): JsonSchemaNode {
  return projectTranslationSchema;
}

export function getProjectTranslationSchemaJson(): string {
  return `${JSON.stringify(projectTranslationSchema, null, 2)}\n`;
}
