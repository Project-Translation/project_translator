import { normalizeConfigData, validateConfigStructure } from "./config.normalize";
import { JsonSchemaNode, JsonSchemaType, projectTranslationSchema } from "./config.schema";

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  issues: SchemaValidationIssue[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isSchemaNode(value: unknown): value is JsonSchemaNode {
  return isRecord(value);
}

function buildPropertyPath(basePath: string, key: string): string {
  return basePath === "$" ? `$.${key}` : `${basePath}.${key}`;
}

function isTypeMatched(value: unknown, expectedType: JsonSchemaType): boolean {
  if (expectedType === "null") {
    return value === null;
  }
  if (expectedType === "array") {
    return Array.isArray(value);
  }
  if (expectedType === "integer") {
    return typeof value === "number" && Number.isInteger(value);
  }
  if (expectedType === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (expectedType === "object") {
    return isRecord(value);
  }
  return typeof value === expectedType;
}

function checkType(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  if (!schema.type) {
    return [];
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const matched = types.some((expectedType) => isTypeMatched(value, expectedType));
  if (matched) {
    return [];
  }

  return [
    {
      path,
      message: `类型错误，期望 ${types.join(" | ")}，实际是 ${value === null ? "null" : typeof value}`,
    },
  ];
}

function checkEnum(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  if (!schema.enum || schema.enum.length === 0) {
    return [];
  }

  const matched = schema.enum.some((candidate) => candidate === value);
  if (matched) {
    return [];
  }

  return [
    {
      path,
      message: `值不在允许范围内：${JSON.stringify(schema.enum)}`,
    },
  ];
}

function checkString(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  if (typeof value !== "string") {
    return [];
  }

  const issues: SchemaValidationIssue[] = [];
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    issues.push({
      path,
      message: `字符串长度不能小于 ${schema.minLength}`,
    });
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    issues.push({
      path,
      message: `字符串长度不能大于 ${schema.maxLength}`,
    });
  }
  return issues;
}

function checkNumber(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return [];
  }

  const issues: SchemaValidationIssue[] = [];
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    issues.push({
      path,
      message: `数值不能小于 ${schema.minimum}`,
    });
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    issues.push({
      path,
      message: `数值不能大于 ${schema.maximum}`,
    });
  }
  return issues;
}

function checkArray(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const issues: SchemaValidationIssue[] = [];
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    issues.push({
      path,
      message: `数组长度不能小于 ${schema.minItems}`,
    });
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    issues.push({
      path,
      message: `数组长度不能大于 ${schema.maxItems}`,
    });
  }

  if (schema.items) {
    value.forEach((item, index) => {
      issues.push(...validateValue(item, schema.items as JsonSchemaNode, `${path}[${index}]`));
    });
  }

  return issues;
}

function checkObject(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  if (!isRecord(value)) {
    return [];
  }

  const issues: SchemaValidationIssue[] = [];
  const requiredKeys = Array.isArray(schema.required) ? schema.required : [];
  for (const requiredKey of requiredKeys) {
    if (!(requiredKey in value)) {
      issues.push({
        path: buildPropertyPath(path, requiredKey),
        message: "缺少必填字段",
      });
    }
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  for (const [key, childSchema] of Object.entries(properties)) {
    if (!(key in value)) {
      continue;
    }
    issues.push(...validateValue(value[key], childSchema as JsonSchemaNode, buildPropertyPath(path, key)));
  }

  const additionalProperties = schema.additionalProperties;
  for (const [key, propertyValue] of Object.entries(value)) {
    if (key in properties) {
      continue;
    }

    if (additionalProperties === false) {
      issues.push({
        path: buildPropertyPath(path, key),
        message: "不允许的字段",
      });
      continue;
    }

    if (isSchemaNode(additionalProperties)) {
      issues.push(...validateValue(propertyValue, additionalProperties, buildPropertyPath(path, key)));
    }
  }

  return issues;
}

function validateValue(value: unknown, schema: JsonSchemaNode, path: string): SchemaValidationIssue[] {
  const issues: SchemaValidationIssue[] = [];
  issues.push(...checkType(value, schema, path));
  if (issues.length > 0) {
    return issues;
  }

  issues.push(...checkEnum(value, schema, path));
  issues.push(...checkString(value, schema, path));
  issues.push(...checkNumber(value, schema, path));
  issues.push(...checkArray(value, schema, path));
  issues.push(...checkObject(value, schema, path));
  return issues;
}

export function validateBySchema(
  value: unknown,
  schema: JsonSchemaNode
): SchemaValidationIssue[] {
  return validateValue(value, schema, "$");
}

export function validateProjectTranslationConfig(
  raw: Record<string, unknown>
): SchemaValidationResult {
  const issues = validateBySchema(raw, projectTranslationSchema);

  if (issues.length === 0) {
    try {
      const normalizedConfig = normalizeConfigData(raw);
      validateConfigStructure(normalizedConfig);
    } catch (error) {
      issues.push({
        path: "$",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
