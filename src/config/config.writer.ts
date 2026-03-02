import * as fs from "fs";
import * as path from "path";
import { parse } from "jsonc-parser";
import { canonicalizeRawConfig } from "./config.normalize";

const fsp = fs.promises;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return isRecord(value) || Array.isArray(value);
}

function toArrayIndex(segment: string): number | null {
  if (!/^\d+$/.test(segment)) {
    return null;
  }
  return Number(segment);
}

export async function loadRawConfigForEdit(configPath: string): Promise<Record<string, unknown>> {
  try {
    const content = await fsp.readFile(configPath, "utf-8");
    const parsed = parse(content);
    if (isRecord(parsed)) {
      return canonicalizeRawConfig(parsed);
    }
    return {};
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

export async function saveRawConfigCanonical(
  configPath: string,
  raw: Record<string, unknown>
): Promise<void> {
  const canonical = canonicalizeRawConfig(raw);
  await fsp.mkdir(path.dirname(configPath), { recursive: true });
  await fsp.writeFile(configPath, `${JSON.stringify(canonical, null, 2)}\n`, "utf-8");
}

export function getByKeyPath(obj: Record<string, unknown>, keyPath: string): unknown {
  const parts = keyPath.split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (Array.isArray(current)) {
      const index = toArrayIndex(part);
      if (index === null || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (!isRecord(current) || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

export function setByKeyPath(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown
): void {
  const parts = keyPath.split(".").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("keyPath is empty");
  }

  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const nextShouldBeArray = toArrayIndex(nextPart) !== null;

    if (Array.isArray(current)) {
      const index = toArrayIndex(part);
      if (index === null) {
        throw new Error(`Invalid array index segment "${part}" in keyPath "${keyPath}"`);
      }
      const existing = current[index];
      if (!isContainer(existing)) {
        current[index] = nextShouldBeArray ? [] : {};
      }
      current = current[index];
      continue;
    }

    if (isRecord(current)) {
      const next = current[part];
      if (!isContainer(next)) {
        current[part] = nextShouldBeArray ? [] : {};
      }
      current = current[part];
      continue;
    }

    throw new Error(`Cannot set value at "${keyPath}" because "${part}" is not traversable`);
  }

  const lastPart = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const index = toArrayIndex(lastPart);
    if (index === null) {
      throw new Error(`Invalid array index segment "${lastPart}" in keyPath "${keyPath}"`);
    }
    current[index] = value;
    return;
  }

  if (isRecord(current)) {
    current[lastPart] = value;
    return;
  }

  throw new Error(`Cannot set value at "${keyPath}" because target is not an object/array`);
}

export function removeByKeyPath(obj: Record<string, unknown>, keyPath: string): boolean {
  const parts = keyPath.split(".").filter(Boolean);
  if (parts.length === 0) {
    return false;
  }

  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (Array.isArray(current)) {
      const index = toArrayIndex(part);
      if (index === null || index < 0 || index >= current.length) {
        return false;
      }
      current = current[index];
      continue;
    }

    if (isRecord(current)) {
      const next = current[part];
      if (!isContainer(next)) {
        return false;
      }
      current = next;
      continue;
    }

    return false;
  }

  const lastPart = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const index = toArrayIndex(lastPart);
    if (index === null || index < 0 || index >= current.length) {
      return false;
    }
    current.splice(index, 1);
    return true;
  }

  if (isRecord(current)) {
    return delete current[lastPart];
  }

  return false;
}

export function parseValueByType(input: string, type: string): JsonValue {
  if (type === "string") {
    return input;
  }
  if (type === "number") {
    const n = Number(input);
    if (!Number.isFinite(n)) {
      throw new Error(`Invalid number: ${input}`);
    }
    return n;
  }
  if (type === "boolean") {
    if (input === "true") return true;
    if (input === "false") return false;
    throw new Error(`Invalid boolean: ${input}`);
  }
  if (type === "json") {
    return JSON.parse(input) as JsonValue;
  }

  if (input === "true") return true;
  if (input === "false") return false;
  if (input === "null") return null;
  const numeric = Number(input);
  if (Number.isFinite(numeric) && `${numeric}` === input) {
    return numeric;
  }

  try {
    return JSON.parse(input) as JsonValue;
  } catch {
    return input;
  }
}
