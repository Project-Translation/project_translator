import * as fs from "fs";
import * as path from "path";

// AI return codes
export const AI_RETURN_CODE = {
  OK: "OK",
  NO_NEED_TRANSLATE: "727d2eb8-8683-42bd-a1d0-f604fcd82163",
};

export type SystemPromptLanguage = "en" | "zh-cn";

const PROMPTS_DIR_CANDIDATES = [
  // Bundled extension: out/extension.js
  path.resolve(__dirname, "../prompts"),
  // tsc output: out/config/prompt.js
  path.resolve(__dirname, "../../prompts"),
];

function resolvePromptsDir(): string | null {
  for (const dir of PROMPTS_DIR_CANDIDATES) {
    // Probe at least one prompt file.
    if (
      fs.existsSync(path.join(dir, "system_prompt_part1.en.md")) ||
      fs.existsSync(path.join(dir, "system_prompt_part1.md"))
    ) {
      return dir;
    }
  }
  return null;
}

const promptsDir = resolvePromptsDir();

const promptCache: Map<string, string> = new Map();

function readPromptFile(fileName: string): string {
  if (!promptsDir) {
    return "";
  }
  const cached = promptCache.get(fileName);
  if (cached !== undefined) {
    return cached;
  }
  const filePath = path.join(promptsDir, fileName);
  if (!fs.existsSync(filePath)) {
    promptCache.set(fileName, "");
    return "";
  }
  const content = fs.readFileSync(filePath, "utf-8");
  promptCache.set(fileName, content);
  return content;
}

export function normalizeSystemPromptLanguage(input: unknown): SystemPromptLanguage {
  const raw = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (
    raw === "en" ||
    raw === "en-us" ||
    raw === "en_us" ||
    raw === "english"
  ) {
    return "en";
  }
  if (
    raw === "zh" ||
    raw === "zh-cn" ||
    raw === "zh_cn" ||
    raw === "zh-hans" ||
    raw === "zh_hans" ||
    raw === "chinese" ||
    raw === "chs"
  ) {
    return "zh-cn";
  }
  return "en";
}

function pickPromptFile(
  baseNameWithoutExt: string,
  lang: SystemPromptLanguage
): string {
  return lang === "en"
    ? `${baseNameWithoutExt}.en.md`
    : `${baseNameWithoutExt}.md`;
}

function readPromptFileByLanguage(
  baseNameWithoutExt: string,
  lang: SystemPromptLanguage
): string {
  const primary = pickPromptFile(baseNameWithoutExt, lang);
  const primaryContent = readPromptFile(primary);
  if (primaryContent.trim().length > 0) {
    return primaryContent;
  }
  // Fallback to the other language file if primary is missing.
  const fallbackLang: SystemPromptLanguage = lang === "en" ? "zh-cn" : "en";
  const fallback = pickPromptFile(baseNameWithoutExt, fallbackLang);
  return readPromptFile(fallback);
}

export function getSystemPrompts(langInput?: unknown): {
  part1: string;
  part2: string;
  diffSystemPrompt: string;
  customPromptSectionTitle: string;
} {
  const lang = normalizeSystemPromptLanguage(langInput);
  return {
    part1: readPromptFileByLanguage("system_prompt_part1", lang),
    part2: readPromptFileByLanguage("system_prompt_part2", lang),
    diffSystemPrompt: readPromptFileByLanguage("diff_system_prompt", lang),
    customPromptSectionTitle:
      lang === "en" ? "# User Custom Translation Requirements" : "# 用户自定义翻译要求",
  };
}

// Backward compatibility: keep old exports (now default to English).
export const DEFAULT_SYSTEM_PROMPT_PART1 = getSystemPrompts("en").part1;
export const DEFAULT_SYSTEM_PROMPT_PART2 = getSystemPrompts("en").part2;
export const DIFF_SYSTEM_PROMPT = getSystemPrompts("en").diffSystemPrompt;

// User prompt for differential translation (task info prompt)
export function getDiffSystemPrompt(
  sourceLang: string,
  targetLang: string,
  sourcePath: string,
  langInput?: unknown
) {
  const lang = normalizeSystemPromptLanguage(langInput);
  if (lang === "en") {
    return `# Differential Translation Task

## File Info

- **Source (SOURCE)**: ${sourcePath} (${sourceLang})
- **Target (TARGET)**: ${sourcePath} (${targetLang})
- **Source language**: ${sourceLang}
- **Target language**: ${targetLang}

## Goal

Compare SOURCE and TARGET, identify differences, and output JSON-formatted SEARCH/REPLACE operations to sync changes.

## Steps

### Step 1: Compare Content

- Compare SOURCE and TARGET section by section
- Identify three types of differences:
  - **Additions**: content present in SOURCE but missing in TARGET
  - **Modifications**: content present in both but different
  - **Deletions**: content present in TARGET but missing in SOURCE

### Step 2: Generate JSON Diff Objects

For each difference, generate a change object:

**Additions**:
- Find an appropriate insertion location in TARGET
- Let search match existing nearby content around the insertion point
- Let replace include existing text + translation of the added content

**Modifications**:
- Let search precisely match existing content in TARGET
- Let replace contain the correct translation of SOURCE content

**Deletions**:
- Let search match the content to remove in TARGET
- Let replace be an empty string

### Step 3: Validate Output

Check the generated JSON:
- It matches the specified JSON format
- search precisely matches TARGET (including spaces, indentation, newlines)
- replace is a correct translation
- It covers all required differences

### Step 4: Return Result

Output a complete JSON object that includes:
- has_changes: boolean indicating whether there are changes
- changes: array of change objects

## Notes

1. **Translation quality**: accurate, natural, target-language appropriate
2. **Formatting**: preserve all formatting markers, indentation, blank lines
3. **Code**: keep code unchanged; only translate comments and documentation
4. **Proper nouns**: keep proper nouns, API names, technical terms
5. **JSON only**: output valid JSON only; do not add markdown fences or explanations

Now compare SOURCE and TARGET and generate the JSON diff object.
`;
  }

  return `# 差异化翻译任务
	
## 文件信息
	
- **源文件（SOURCE）**：${sourcePath} (${sourceLang})
- **目标文件（TARGET）**：${sourcePath} (${targetLang})
- **源语言**：${sourceLang}
- **目标语言**：${targetLang}

## 任务目标

对比SOURCE和TARGET，识别差异并生成JSON格式的SEARCH/REPLACE操作来同步变更。

## 执行步骤

### 步骤1：内容对比

- 逐段对比SOURCE和TARGET的内容
- 识别三种差异类型：
  - **新增**：SOURCE有但TARGET没有的内容
  - **修改**：SOURCE和TARGET都有但内容不同的部分
  - **删除**：TARGET有但SOURCE没有的内容

### 步骤2：生成JSON差异对象

为每个差异生成change对象：

**新增内容**：
- 在TARGET中找到合适的插入位置
- search匹配插入位置附近的现有内容
- replace包含现有文本+新增内容的翻译

**修改内容**：
- search精确匹配TARGET中的现有内容
- replace包含SOURCE内容的正确翻译

**删除内容**：
- search匹配TARGET中需要删除的内容
- replace设为空字符串

### 步骤3：验证输出

检查生成的JSON：
- 是否符合指定的JSON格式
- search是否精确匹配TARGET（包括空格、缩进、换行）
- replace是否是正确的翻译
- 是否包含所有必要的差异

### 步骤4：返回结果

输出完整的JSON对象，包含：
- has_changes: 布尔值，表示是否有变化
- changes: change对象数组

## 注意事项

1. **翻译质量**：确保翻译准确、自然、符合目标语言习惯
2. **格式保持**：保留所有格式标记、缩进、空行
3. **代码处理**：代码部分保持不变，只翻译注释和说明
4. **专有名词**：保留专有名词、API名称、技术术语
5. **JSON格式**：确保输出是有效的JSON，不要添加markdown围栏或其他说明

现在开始对比SOURCE和TARGET，生成JSON格式的差异对象。
`;
}
