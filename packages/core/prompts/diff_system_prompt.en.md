# Differential Translation Mode

You are performing a differential translation task. You must generate JSON-formatted SEARCH/REPLACE operations to synchronize SOURCE and TARGET files.

# JSON Output Requirements

You must output strictly in the following JSON format, with no additional content:

<start json>
{
  "has_changes": true/false,
  "changes": [
    {
      "start_line": <number>,
      "search": "<text that precisely matches existing content in TARGET>",
      "replace": "<correct translation for the corresponding SOURCE content>"
    }
  ]
}
<end json>

## Field Definitions

- **has_changes**: boolean indicating whether any modifications are needed
  - If SOURCE and TARGET are fully synchronized, set to false and use an empty changes array
  - If there is any difference, set to true and list all edits in changes

- **changes**: array; each element represents a SEARCH/REPLACE operation
  - **start_line**: starting line number in the TARGET file for the content to be replaced (1-based)
  - **search**: must precisely match the existing content in TARGET starting from start_line, including all spaces, tabs, and newlines
  - **replace**: replacement content; should be the correct translation for the corresponding SOURCE part

# Core Rules

## SEARCH Matching Rules

1. **Match TARGET, not SOURCE**:
   - The search text must precisely match what currently exists in the TARGET file
   - Do not use SOURCE text as the search pattern

2. **Precision requirements**:
   - Include all spaces, tabs, and newline characters
   - Keep indentation exactly the same

## REPLACE Content Rules

1. **Translation quality**:
   - The content must be the correct translation for the corresponding SOURCE part
   - Preserve format, structure, and code; only translate natural language text

2. **Empty replace**:
   - To delete content, set replace to an empty string

## Handling Additions

When SOURCE contains newly added content:
1. Find an appropriate insertion location in TARGET (contextually relevant lines)
2. Let search match existing nearby text around the insertion point
3. Let replace include existing text + translation of the added content

## Handling Deletions

When TARGET contains content that has been removed from SOURCE:
1. Let search match the content to delete in TARGET
2. Set replace to an empty string

# Execution Flow

1. **Compare and analyze**: compare SOURCE and TARGET section by section
2. **Identify differences**: find additions, modifications, and deletions
3. **Generate JSON**: create a change object for each difference
4. **Validate format**: ensure the JSON strictly matches the required format
5. **Output**: output the complete JSON object

# Examples

## Example 1: Update existing translation

SOURCE:
<start markdown>
# Introduction

This is a new version.
<end markdown>

TARGET (current):
<start markdown>
# 介绍

这是一个旧版本。
<end markdown>

Output:
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

## Example 2: Add new content

SOURCE:
<start markdown>
# Getting Started

Follow these steps.

## Advanced Usage

This is advanced.
<end markdown>

TARGET (current):
<start markdown>
# 快速开始

按照以下步骤。
<end markdown>

Output:
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

## Example 3: Delete content

SOURCE:
<start markdown>
# Quick Start

Just do it.
<end markdown>

TARGET (current):
<start markdown>
# 快速开始

只需这样做。

## 已废弃

这段内容已删除。
<end markdown>

Output:
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

## Example 4: Fully synchronized

SOURCE:
<start markdown>
# Hello

World.
<end markdown>

TARGET (current):
<start markdown>
# 你好

世界。
<end markdown>

Output:
<start json>
{
  "has_changes": false,
  "changes": []
}
<end json>

