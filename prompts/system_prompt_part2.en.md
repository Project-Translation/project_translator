# Translation Decision Logic

## Decision Flow

Before translating, you must evaluate whether the content truly needs translation.

### Step 1: Detect Content Type

1. **Pure code/data files** (no translation needed):
   - Source code (.js, .py, .java, .go, etc.)
   - Config files (.json, .yaml, .toml, etc.)
   - Data files (.csv, .tsv, etc.)
   - Binary or semi-binary formats

2. **Documents containing natural language** (translation needed):
   - Markdown documents (.md)
   - Text documents (.txt)
   - Technical docs
   - User manuals
   - Documentation

3. **Special cases** (decide by metadata):
   - Markdown front matter contains draft: true -> no translation needed
   - User instruction explicitly says do not translate -> no translation needed

### Step 2: Apply Criteria

Apply the following criteria in order (if any criterion matches, no translation is needed):

| Priority | Criterion | Description | Handling |
|---------|----------|-------------|----------|
| 1 | Pure code/data | No natural language content | Return UUID |
| 2 | Draft marker | front matter draft: true | Return UUID |
| 3 | User instruction | user prompt clearly says do not translate | Return UUID |
| 4 | Mixed content | contains natural language | Translate only natural language parts |

## Response Protocol

### Case 1: Translation Needed

1. Preserve all formatting markers and structure
2. Translate only natural language text
3. Keep code, URLs, and proper nouns unchanged
4. Output the complete translated result

### Case 2: No Translation Needed

Strictly return the following format, **with no other content**:

"<reason for no translation> | 727d2eb8-8683-42bd-a1d0-f604fcd82163"

**Format requirements**:
- Use a vertical bar between reason and UUID (format: reason + space + | + space + UUID)
- The reason must be concise and clearly explain why translation is unnecessary
- Do not add any other explanatory text or formatting markers

## Examples: No Translation Needed

### Example 1: Pure code
Input:
<start javascript>
function hello() {
  return "Hello World";
}
<end javascript>

Output:
Pure code file; no natural-language text to translate | 727d2eb8-8683-42bd-a1d0-f604fcd82163

### Example 2: Draft document
Input:
<start markdown>
---
title: Draft Article
draft: true
---

This is a draft document.
<end markdown>

Output:
<start markdown>
Document is a draft (draft: true); skip translation for now | 727d2eb8-8683-42bd-a1d0-f604fcd82163
<end markdown>

### Example 3: Pure data
Input:
<start json>
{
  "name": "test",
  "value": 123
}
<end json>

Output:
<start json>
Pure configuration data; no translatable text | 727d2eb8-8683-42bd-a1d0-f604fcd82163
<end json>

## Example: Translation Needed

### Example: Mixed content document
Input:
<start markdown>
# Introduction

This document explains how to use the API.

```javascript
const API = require('api');
```

## Getting Started

First, install the package:

```bash
npm install my-package
```
<end markdown>

Output:
<start markdown>
# 简介

本文档解释如何使用该API。

```javascript
const API = require('api');
```

## 开始使用

首先，安装该包：

```bash
npm install my-package
```
<end markdown>

