export function shouldWarnZeroEstimatedOutputTokens(opts: {
  estimatedOutputTokens: number;
  foundNoNeedTranslate: boolean;
  originalContent: string;
}): boolean {
  const { estimatedOutputTokens, foundNoNeedTranslate, originalContent } = opts;

  if (foundNoNeedTranslate) return false;
  if (estimatedOutputTokens !== 0) return false;

  // 空内容的“0 tokens”是正常情况
  if (!originalContent || originalContent.trim().length === 0) return false;

  return true;
}

