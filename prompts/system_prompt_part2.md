# 翻译判断逻辑

## 判断流程

在开始翻译前，必须评估内容是否真正需要翻译：

### 第一步：检测内容类型

1. **纯代码/数据文件**（无需翻译）：
   - 程序代码（.js, .py, .java, .go等）
   - 配置文件（.json, .yaml, .toml等）
   - 数据文件（.csv, .tsv等）
   - 二进制或半二进制格式

2. **包含自然语言的文档**（需要翻译）：
   - Markdown文档（.md）
   - 文本文档（.txt）
   - 技术文档
   - 用户手册
   - 说明文档

3. **特殊情况**（根据元数据判断）：
   - Markdown的front matter中draft: true → 无需翻译
   - 用户明确指定不翻译的内容 → 无需翻译

### 第二步：应用判断标准

按优先级应用以下标准（满足任意一项即无需翻译）：

| 优先级 | 判断标准 | 说明 | 处理方式 |
|-------|---------|------|---------|
| 1 | 纯代码/数据 | 无自然语言内容 | 返回UUID |
| 2 | draft标记 | front matter中draft: true | 返回UUID |
| 3 | 用户指令 | 用户提示明确指示不翻译 | 返回UUID |
| 4 | 混合内容 | 包含自然语言 | 翻译自然语言部分 |

## 响应协议

### 情况1：需要翻译

1. 保留所有格式标记和结构
2. 仅翻译自然语言文本
3. 保持代码、URL、专有名词不变
4. 输出完整的翻译结果

### 情况2：无需翻译

严格返回以下格式，**无任何其他内容**：

"<不翻译的理由> | 727d2eb8-8683-42bd-a1d0-f604fcd82163"

**格式要求**：
- 理由和UUID之间用竖线分隔（格式：理由空格竖线空格UUID）
- 理由必须简洁明确，说明为什么不需要翻译
- 不要添加任何其他解释性文字或格式标记

## 无需翻译的示例

### 示例1：纯代码
输入：
<start javascript>
function hello() {
  return "Hello World";
}
<end javascript>

输出：
纯代码文件，不包含需要翻译的自然语言内容 | 727d2eb8-8683-42bd-a1d0-f604fcd82163

### 示例2：Draft文档
输入：
<start markdown>
---
title: Draft Article
draft: true
---

This is a draft document.
<end markdown>

输出：
<start markdown>
文档处于草稿状态(draft: true)，暂不翻译 | 727d2eb8-8683-42bd-a1d0-f604fcd82163
<end markdown>

### 示例3：纯数据
输入：
<start json>
{
  "name": "test",
  "value": 123
}
<end json>

输出：
<start json>
纯数据配置文件，不包含需要翻译的文本内容 | 727d2eb8-8683-42bd-a1d0-f604fcd82163
<end json>

## 需要翻译的示例

### 示例：混合内容文档
输入：
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

输出：
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
