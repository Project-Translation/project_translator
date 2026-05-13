type LogLevel = 'info' | 'warn' | 'error'

export interface ApplyOptions {
  fuzzyThreshold?: number // 1.0 为严格完全匹配；<1 允许模糊匹配
  bufferLines?: number // 在起始行附近的搜索缓冲区
}

export interface ApplyResultPart {
  success: boolean
  error?: string
  details?: Record<string, unknown>
}

export interface ApplyResult {
  updatedText: string
  appliedCount: number
  failParts?: ApplyResultPart[]
}

// 轻量字符串归一化（处理智能引号等易错字符）
function normalizeString(input: string): string {
  return input
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // 各类单引号 → '
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // 各类双引号 → "
}

// 简易 Levenshtein 距离（避免新增依赖）
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) {return n}
  if (n === 0) {return m}
  const dp = new Array(n + 1)
  for (let j = 0; j <= n; j++) {dp[j] = j}
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      if (a.charCodeAt(i - 1) === b.charCodeAt(j - 1)) {dp[j] = prev}
      else {dp[j] = Math.min(prev + 1, dp[j] + 1, dp[j - 1] + 1)}
      prev = temp
    }
  }
  return dp[n]
}

function getSimilarity(original: string, search: string): number {
  if (search.length === 0) {return 0}
  const o = normalizeString(original)
  const s = normalizeString(search)
  if (o === s) {return 1}
  const dist = levenshtein(o, s)
  const maxLen = Math.max(o.length, s.length)
  return 1 - dist / (maxLen || 1)
}

function everyLineHasLineNumbers(text: string): boolean {
  if (!text.trim()) {return false}
  return text.split(/\r?\n/).every(l => /^\s*\d+\s*\|\s?/.test(l) || l.trim() === '')
}

function stripLineNumbers(text: string, aggressive = false): string {
  const lines = text.split(/\r?\n/)
  return lines
    .map(l => {
      if (/^\s*\d+\s*\|\s?/.test(l)) {return l.replace(/^\s*\d+\s*\|\s?/, '')}
      return aggressive ? l.replace(/\b\d+\s*\|\s?/g, '') : l
    })
    .join('\n')
}

function addLineNumbers(text: string, start = 1): string {
  const lines = text.split(/\r?\n/)
  return lines.map((l, i) => `${start + i} | ${l}`).join('\n')
}

function middleOutFuzzySearch(
  lines: string[],
  searchChunk: string,
  startIndex: number,
  endIndex: number
) {
  let bestScore = 0
  let bestMatchIndex = -1
  let bestMatchContent = ''
  const searchLen = searchChunk.split(/\r?\n/).length
  const mid = Math.floor((startIndex + endIndex) / 2)
  let left = mid
  let right = mid + 1
  while (left >= startIndex || right <= endIndex - searchLen) {
    if (left >= startIndex) {
      const chunk = lines.slice(left, left + searchLen).join('\n')
      const sim = getSimilarity(chunk, searchChunk)
      if (sim > bestScore) {
        bestScore = sim
        bestMatchIndex = left
        bestMatchContent = chunk
      }
      left--
    }
    if (right <= endIndex - searchLen) {
      const chunk = lines.slice(right, right + searchLen).join('\n')
      const sim = getSimilarity(chunk, searchChunk)
      if (sim > bestScore) {
        bestScore = sim
        bestMatchIndex = right
        bestMatchContent = chunk
      }
      right++
    }
  }
  return { bestScore, bestMatchIndex, bestMatchContent }
}

function unescapeMarkers(content: string): string {
  return content
    .replace(/^\\<<<<<<</gm, '<<<<<<<')
    .replace(/^\\=======/gm, '=======')
    .replace(/^\\>>>>>>>/gm, '>>>>>>>')
    .replace(/^\\-------/gm, '-------')
    .replace(/^\\:end_line:/gm, ':end_line:')
    .replace(/^\\:start_line:/gm, ':start_line:')
}

function validateMarkerSequencing(diffContent: string): { success: true } | { success: false; error: string } {
  enum State { START, AFTER_SEARCH, AFTER_SEPARATOR }
  let state: State = State.START
  let lineNo = 0
  const SEARCH_RE = /^<<<<<<< SEARCH>?$/
  const SEP = '======='
  const REPLACE = '>>>>>>> REPLACE'
  const SEARCH_PREFIX = '<<<<<<<'
  const REPLACE_PREFIX = '>>>>>>>'

  const lines = diffContent.split('\n')
  const searchCount = lines.filter(l => SEARCH_RE.test(l.trim())).length
  const sepCount = lines.filter(l => l.trim() === SEP).length
  const replaceCount = lines.filter(l => l.trim() === REPLACE).length
  const likelyBad = searchCount !== replaceCount || sepCount < searchCount

  const mergeErr = (found: string, expected: string) => ({
    success: false as const,
    error:
      `ERROR: Special marker '${found}' at line ${lineNo}. Escape it inside SEARCH/REPLACE blocks. Expected: ${expected}`,
  })
  const malformed = (found: string, expected: string) => ({
    success: false as const,
    error: `ERROR: Malformed diff: found '${found}' at line ${lineNo}. Expected: ${expected}`,
  })

  for (const raw of lines) {
    lineNo++
    const marker = raw.trim()
    if (state === State.AFTER_SEPARATOR) {
      if (marker.startsWith(':start_line:') && !marker.startsWith('\\:start_line:')) {
        return { success: false, error: `ERROR: ':start_line:' is not allowed in REPLACE at line ${lineNo}` }
      }
      if (marker.startsWith(':end_line:') && !marker.startsWith('\\:end_line:')) {
        return { success: false, error: `ERROR: ':end_line:' is not allowed in REPLACE at line ${lineNo}` }
      }
    }
    switch (state) {
      case State.START:
        if (marker === SEP) {return likelyBad ? malformed(SEP, '<<<<<<< SEARCH') : mergeErr(SEP, '<<<<<<< SEARCH')}
        if (marker === REPLACE) {return malformed(REPLACE, '<<<<<<< SEARCH')}
        if (marker.startsWith(REPLACE_PREFIX)) {return mergeErr(marker, '<<<<<<< SEARCH')}
        if (SEARCH_RE.test(marker)) {state = State.AFTER_SEARCH}
        else if (marker.startsWith(SEARCH_PREFIX)) {return mergeErr(marker, '<<<<<<< SEARCH')}
        break
      case State.AFTER_SEARCH:
        if (SEARCH_RE.test(marker)) {return malformed('<<<<<<< SEARCH', '=======')}
        if (marker.startsWith(SEARCH_PREFIX)) {return mergeErr(marker, '=======')}
        if (marker === REPLACE) {return malformed(REPLACE, '=======')}
        if (marker.startsWith(REPLACE_PREFIX)) {return mergeErr(marker, '=======')}
        if (marker === SEP) {state = State.AFTER_SEPARATOR}
        break
      case State.AFTER_SEPARATOR:
        if (SEARCH_RE.test(marker)) {return malformed('<<<<<<< SEARCH', '>>>>>>> REPLACE')}
        if (marker.startsWith(SEARCH_PREFIX)) {return mergeErr(marker, '>>>>>>> REPLACE')}
        if (marker === SEP) {return likelyBad ? malformed(SEP, '>>>>>>> REPLACE') : mergeErr(SEP, '>>>>>>> REPLACE')}
        if (marker === REPLACE) {state = State.START}
        else if (marker.startsWith(REPLACE_PREFIX)) {return mergeErr(marker, '>>>>>>> REPLACE')}
        break
    }
  }
  return state === State.START ? { success: true } : { success: false, error: `ERROR: Unexpected end of sequence` }
}

export class SearchReplaceDiffApplier {
  static apply(
    originalText: string,
    diffContent: string | Array<{ content: string; startLine?: number }>,
    options?: ApplyOptions,
    logger?: (m: string, level?: LogLevel) => void
  ): ApplyResult {
    const log = (m: string, lvl: LogLevel = 'info') => {
      try { if (logger) {logger(m, lvl)} } catch {}
    }
    const fuzzyThreshold = options?.fuzzyThreshold ?? 1.0
    const bufferLines = options?.bufferLines ?? 40

    const lineEnding = originalText.includes('\r\n') ? '\r\n' : '\n'
    let resultLines = originalText.split(/\r?\n/)
    let delta = 0
    let appliedCount = 0
    const failParts: ApplyResultPart[] = []

    const diffs: Array<{ content: string; startLine?: number }> = Array.isArray(diffContent)
      ? diffContent
      : [{ content: diffContent }]

    const sanitize = (s: string) => {
      // 去除代码围栏，合并重复的 REPLACE 结尾标记
      let t = s.replace(/^```.*$/gm, '')
      t = t.replace(/(\r?\n)>>>>>>> REPLACE(?:\s*\r?\n>>>>>>> REPLACE)+/g, '$1>>>>>>> REPLACE')
      
      // 修复常见的格式错误
      // 1. 修复缺少空格的 SEARCH 标记: <<<<<<<SEARCH -> <<<<<<< SEARCH
      t = t.replace(/<<<<<<<SEARCH/g, '<<<<<<< SEARCH')
      // 2. 修复缺少空格的 REPLACE 标记: >>>>>>>REPLACE -> >>>>>>> REPLACE  
      t = t.replace(/>>>>>>>REPLACE/g, '>>>>>>> REPLACE')
      
      return t
    }

    for (const item of diffs) {
      const raw = sanitize(item.content || '')
      const sequence = validateMarkerSequencing(raw)
      if (!sequence.success) {
        failParts.push({ success: false, error: sequence.error })
        continue
      }

      const matchRe = new RegExp(
        '(?:^|\\n)(?<!\\\\)<<<<<<< SEARCH>?\\s*\\n((?:\\:start_line:\\s*(\\d+)\\s*\\n))?((?:\\:end_line:\\s*(\\d+)\\s*\\n))?((?<!\\\\)-------\\s*\\n)?([\\s\\S]*?)(?:\\n)?(?:(?<=\\n)(?<!\\\\)=======\\s*\\n)([\\s\\S]*?)(?:\\n)?(?:(?<=\\n)(?<!\\\\)>>>>>>> REPLACE)(?=\\n|$)',
        'g'
      )
      const matches: RegExpExecArray[] = []
      let m: RegExpExecArray | null
      while ((m = matchRe.exec(raw)) !== null) {
        matches.push(m)
        if (m.index === matchRe.lastIndex) {matchRe.lastIndex++}
      }
      if (matches.length === 0) {
        failParts.push({ success: false, error: 'Invalid diff format - missing SEARCH/REPLACE sections' })
        continue
      }

      const replacements = matches
        .map(m => ({
          startLine: (item.startLine ?? 0) || Number(m[2] ?? 0),
          searchContent: m[6] ?? '',
          replaceContent: m[7] ?? '',
        }))
        .sort((a, b) => a.startLine - b.startLine)

      for (const r of replacements) {
        let searchContent = unescapeMarkers(r.searchContent)
        let replaceContent = unescapeMarkers(r.replaceContent)
        let startLine = r.startLine + (r.startLine === 0 ? 0 : delta)

        const hasAllLineNums =
          (everyLineHasLineNumbers(searchContent) && everyLineHasLineNumbers(replaceContent)) ||
          (everyLineHasLineNumbers(searchContent) && replaceContent.trim() === '')
        if (hasAllLineNums && startLine === 0) {
          const first = searchContent.split('\n')[0]
          const num = parseInt(first.split('|')[0])
          if (!Number.isNaN(num)) {startLine = num}
        }
        if (hasAllLineNums) {
          searchContent = stripLineNumbers(searchContent)
          replaceContent = stripLineNumbers(replaceContent)
        }

        if (searchContent === replaceContent) {
          failParts.push({ success: false, error: 'Search and replace content are identical' })
          continue
        }

        let searchLines = searchContent === '' ? [] : searchContent.split(/\r?\n/)
        let replaceLines = replaceContent === '' ? [] : replaceContent.split(/\r?\n/)
        if (searchLines.length === 0) {
          failParts.push({ success: false, error: 'Empty search content is not allowed' })
          continue
        }

        const endLine = r.startLine + searchLines.length - 1
        let matchIndex = -1
        let bestMatchScore = 0
        let bestMatchContent = ''
        const searchChunk = searchLines.join('\n')

        let searchStartIndex = 0
        let searchEndIndex = resultLines.length
        if (startLine) {
          const exactStart = Math.max(0, Math.min(resultLines.length - 1, startLine - 1))
          const searchLen = searchLines.length
          const exactEnd = Math.min(resultLines.length - 1, exactStart + searchLen - 1)
          const chunk = resultLines.slice(exactStart, exactEnd + 1).join('\n')
          const sim = getSimilarity(chunk, searchChunk)
          if (sim >= fuzzyThreshold) {
            matchIndex = exactStart
            bestMatchScore = sim
            bestMatchContent = chunk
          } else {
            searchStartIndex = Math.max(0, startLine - (bufferLines + 1))
            searchEndIndex = Math.min(resultLines.length, startLine + searchLines.length + bufferLines)
          }
        }

        if (matchIndex === -1) {
          const { bestScore, bestMatchIndex, bestMatchContent: mid } = middleOutFuzzySearch(
            resultLines,
            searchChunk,
            searchStartIndex,
            searchEndIndex
          )
          matchIndex = bestMatchIndex
          bestMatchScore = bestScore
          bestMatchContent = mid
        }

        if (matchIndex === -1 || bestMatchScore < fuzzyThreshold) {
          const aggressiveSearch = stripLineNumbers(searchContent, true)
          const aggressiveReplace = stripLineNumbers(replaceContent, true)
          const aggressiveLines = aggressiveSearch ? aggressiveSearch.split(/\r?\n/) : []
          const aggressiveChunk = aggressiveLines.join('\n')
          const { bestScore, bestMatchIndex, bestMatchContent: agg } = middleOutFuzzySearch(
            resultLines,
            aggressiveChunk,
            searchStartIndex,
            searchEndIndex
          )
          if (bestMatchIndex !== -1 && bestScore >= fuzzyThreshold) {
            matchIndex = bestMatchIndex
            bestMatchScore = bestScore
            bestMatchContent = agg
            searchContent = aggressiveSearch
            replaceContent = aggressiveReplace
            searchLines = aggressiveLines
            replaceLines = replaceContent ? replaceContent.split(/\r?\n/) : []
          } else {
            // 进一步兜底：放宽搜索范围到整文件
            const fullTry = middleOutFuzzySearch(resultLines, searchChunk, 0, resultLines.length)
            if (fullTry.bestMatchIndex !== -1 && fullTry.bestScore >= fuzzyThreshold) {
              matchIndex = fullTry.bestMatchIndex
              bestMatchScore = fullTry.bestScore
              bestMatchContent = fullTry.bestMatchContent
            } else {
              const fullAggTry = middleOutFuzzySearch(resultLines, aggressiveChunk, 0, resultLines.length)
              if (fullAggTry.bestMatchIndex !== -1 && fullAggTry.bestScore >= fuzzyThreshold) {
                matchIndex = fullAggTry.bestMatchIndex
                bestMatchScore = fullAggTry.bestScore
                bestMatchContent = fullAggTry.bestMatchContent
                searchContent = aggressiveSearch
                replaceContent = aggressiveReplace
                searchLines = aggressiveLines
                replaceLines = replaceContent ? replaceContent.split(/\r?\n/) : []
              }
            }
          }

          if (matchIndex === -1 || bestMatchScore < fuzzyThreshold) {
            const originalSection =
              startLine !== undefined && endLine !== undefined
                ? `\n\nOriginal Content:\n${addLineNumbers(
                    resultLines
                      .slice(Math.max(0, startLine - 1 - bufferLines), Math.min(resultLines.length, endLine + bufferLines))
                      .join('\n'),
                    Math.max(1, startLine - bufferLines)
                  )}`
                : `\n\nOriginal Content:\n${addLineNumbers(resultLines.join('\n'))}`
            const bestSection = bestMatchContent ? `\n\nBest Match Found:\n${addLineNumbers(bestMatchContent, (matchIndex === -1 ? 0 : matchIndex) + 1)}` : `\n\nBest Match Found:\n(no match)`
            failParts.push({
              success: false,
              error: `No sufficiently similar match found${startLine ? ` at line: ${startLine}` : ''} (${Math.floor(
                bestMatchScore * 100
              )}% similar, needs ${Math.floor(fuzzyThreshold * 100)}%)\n\nSearch Content:\n${searchChunk}${bestSection}${originalSection}`,
            })
            continue
          }
        }

        const matchedLines = resultLines.slice(matchIndex, matchIndex + searchLines.length)
        const originalIndents = matchedLines.map(l => {
          const m = l.match(/^[\t ]*/)
          return m ? m[0] : ''
        })
        const searchIndents = searchLines.map(l => {
          const m = l.match(/^[\t ]*/)
          return m ? m[0] : ''
        })

        const indentedReplaceLines = replaceLines.map(line => {
          const matchedIndent = originalIndents[0] || ''
          const currentIndent = (line.match(/^[\t ]*/) || [''])[0]
          const searchBaseIndent = searchIndents[0] || ''
          const relativeLevel = currentIndent.length - searchBaseIndent.length
          const finalIndent =
            relativeLevel < 0
              ? matchedIndent.slice(0, Math.max(0, matchedIndent.length + relativeLevel))
              : matchedIndent + currentIndent.slice(searchBaseIndent.length)
          return finalIndent + line.trim()
        })

        const before = resultLines.slice(0, matchIndex)
        const after = resultLines.slice(matchIndex + searchLines.length)
        resultLines = [...before, ...indentedReplaceLines, ...after]
        delta = delta - searchLines.length + replaceLines.length
        appliedCount++
      }
    }

    const updatedText = resultLines.join(lineEnding)
    if (appliedCount === 0) {
      log('No SEARCH/REPLACE blocks applied', 'warn')
    }
    return { updatedText, appliedCount, failParts: failParts.length ? failParts : undefined }
  }
}


