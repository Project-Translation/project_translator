import { expect } from 'chai'
import { shouldWarnZeroEstimatedOutputTokens } from '../../services/translationWarnings'

describe('shouldWarnZeroEstimatedOutputTokens', () => {
  it('returns false when foundNoNeedTranslate is true', () => {
    expect(shouldWarnZeroEstimatedOutputTokens({
      estimatedOutputTokens: 0,
      foundNoNeedTranslate: true,
      originalContent: 'Hello'
    })).to.eq(false)
  })

  it('returns false when estimatedOutputTokens is non-zero', () => {
    expect(shouldWarnZeroEstimatedOutputTokens({
      estimatedOutputTokens: 1,
      foundNoNeedTranslate: false,
      originalContent: 'Hello'
    })).to.eq(false)
  })

  it('returns false when originalContent is empty/whitespace', () => {
    expect(shouldWarnZeroEstimatedOutputTokens({
      estimatedOutputTokens: 0,
      foundNoNeedTranslate: false,
      originalContent: ''
    })).to.eq(false)

    expect(shouldWarnZeroEstimatedOutputTokens({
      estimatedOutputTokens: 0,
      foundNoNeedTranslate: false,
      originalContent: '   \n\t'
    })).to.eq(false)
  })

  it('returns true for non-empty originalContent with 0 output tokens', () => {
    expect(shouldWarnZeroEstimatedOutputTokens({
      estimatedOutputTokens: 0,
      foundNoNeedTranslate: false,
      originalContent: 'Non-empty content'
    })).to.eq(true)
  })
})

