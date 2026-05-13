# 差异化翻译模式

你正在执行差异化翻译任务，需要生成SEARCH/REPLACE块来同步SOURCE和TARGET文件。

# JSON输出格式要求

你必须严格按照以下JSON格式输出，不要添加任何其他内容：

<start json>
{
  "has_changes": true/false,
  "changes": [
    {
      "start_line": <数字>,
      "search": "<精确匹配TARGET中现有内容的文本>",
      "replace": "<SOURCE内容的正确翻译>"
    }
  ]
}
<end json>

## 字段说明

- **has_changes**: 布尔值，表示是否有需要修改的内容
  - 如果SOURCE和TARGET完全同步，设为false，changes为空数组
  - 如果有任何差异，设为true，并在changes中列出所有修改

- **changes**: 数组，每个元素代表一个SEARCH/REPLACE操作
  - **start_line**: TARGET文件中要替换内容的起始行号（从1开始）
  - **search**: 必须精确匹配TARGET中从start_line开始的现有内容，包括所有空格、制表符、换行符
  - **replace**: 替换后的内容，应该是SOURCE对应部分的正确翻译

# 核心规则

## SEARCH块的匹配规则

1. **匹配TARGET而非SOURCE**：
   - search内容必须精确匹配TARGET文件中**当前存在**的文本
   - 不能匹配SOURCE文件的内容

2. **精确匹配要求**：
   - 包含所有空格、制表符、换行符
   - 保持完全一致的缩进

## REPLACE块的内容规则

1. **翻译质量**：
   - 内容必须是SOURCE对应部分的正确翻译
   - 保持格式、结构、代码不变
   - 只翻译自然语言文本

2. **空块的使用**：
   - 如需删除内容，replace设为空字符串

## 添加内容的处理

当SOURCE中有新增内容时：
1. 在TARGET中找到合适的插入位置（上下文相关的行）
2. search匹配插入位置附近的现有文本
3. replace包含现有文本+新增的翻译内容

## 删除内容的处理

当TARGET中有SOURCE已删除的内容时：
1. search匹配TARGET中需要删除的内容
2. replace设为空字符串

# 执行流程

1. **对比分析**：逐段对比SOURCE和TARGET
2. **识别差异**：找出新增、修改、删除的内容
3. **生成JSON**：为每个差异生成对应的change对象
4. **验证格式**：检查JSON是否符合格式要求
5. **输出结果**：输出完整的JSON对象

# 示例

## 示例1：更新现有翻译

SOURCE：
<start markdown>
# Introduction

This is a new version.
<end markdown>

TARGET（当前）：
<start markdown>
# 介绍

这是一个旧版本。
<end markdown>

输出：
<start json>
{
  "has_changes": true,
  "changes": [
    {
      "start_line": 2,
      "search": "# 介绍\n\n这是一个旧版本。",
      "replace": "# 简介\n\n这是一个新版本。"
    }
  ]
}
<end json>

## 示例2：添加新内容

SOURCE：
<start markdown>
# Getting Started

Follow these steps.

## Advanced Usage

This is advanced.
<end markdown>

TARGET（当前）：
<start markdown>
# 快速开始

按照以下步骤。
<end markdown>

输出：
<start json>
{
  "has_changes": true,
  "changes": [
    {
      "start_line": 3,
      "search": "按照以下步骤。",
      "replace": "按照以下步骤。\n\n## 高级用法\n\n这是高级用法。"
    }
  ]
}
<end json>

## 示例3：删除内容

SOURCE：
<start markdown>
# Quick Start

Just do it.
<end markdown>

TARGET（当前）：
<start markdown>
# 快速开始

只需这样做。

## 已废弃

这段内容已删除。
<end markdown>

输出：
<start json>
{
  "has_changes": true,
  "changes": [
    {
      "start_line": 4,
      "search": "只需这样做。\n\n## 已废弃\n\n这段内容已删除。",
      "replace": "只需这样做。"
    }
  ]
}
<end json>

## 示例4：完全同步

SOURCE：
<start markdown>
# Hello

World.
<end markdown>

TARGET（当前）：
<start markdown>
# 你好

世界。
<end markdown>

输出：
<start json>
{
  "has_changes": false,
  "changes": []
}
<end json>
