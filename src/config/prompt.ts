import * as fs from "fs";
import * as path from "path";

// AI return codes
export const AI_RETURN_CODE = {
  OK: "OK",
  NO_NEED_TRANSLATE: "727d2eb8-8683-42bd-a1d0-f604fcd82163",
};

const PROMPTS_DIR_CANDIDATES = [
  // Bundled extension: out/extension.js
  path.resolve(__dirname, "../prompts"),
  // tsc output: out/config/prompt.js
  path.resolve(__dirname, "../../prompts"),
];

function resolvePromptsDir(): string | null {
  for (const dir of PROMPTS_DIR_CANDIDATES) {
    if (fs.existsSync(path.join(dir, "system_prompt_part1.md"))) {
      return dir;
    }
  }
  return null;
}

const promptsDir = resolvePromptsDir();

function readPromptFile(fileName: string): string {
  if (!promptsDir) {
    return "";
  }
  const filePath = path.join(promptsDir, fileName);
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf-8");
}

// Default system prompt content - First part - general translation guidelines
export const DEFAULT_SYSTEM_PROMPT_PART1 = readPromptFile("system_prompt_part1.md");

// Default system prompt content - Second part - translation judgment logic
export const DEFAULT_SYSTEM_PROMPT_PART2 = readPromptFile("system_prompt_part2.md");

// System prompt for generating SEARCH/REPLACE diff blocks in JSON format
export const DIFF_SYSTEM_PROMPT = readPromptFile("diff_system_prompt.md");

// User prompt for differential translation
export function getDiffSystemPrompt(
  sourceLang: string,
  targetLang: string,
  sourcePath: string
) {
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
