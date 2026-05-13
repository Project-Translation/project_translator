import { expect } from 'chai'
import { sanitizeUnexpectedCodeFences } from '../../services/translationOutputSanitizer'

describe('sanitizeUnexpectedCodeFences', () => {
  it('strips all code fence lines when original has none', () => {
    const original = [
      'Hello',
      'World',
      ''
    ].join('\n')

    const translated = [
      '```markdown',
      '你好',
      '世界',
      '```',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    expect(sanitized).to.eq(['你好', '世界', ''].join('\n'))
  })

  it('strips all <start ...>/<end ...> tag lines when original has none', () => {
    const original = [
      'Hello',
      'World',
      ''
    ].join('\n')

    const translated = [
      '<start markdown>',
      '你好',
      '世界',
      '<end markdown>',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    expect(sanitized).to.eq(['你好', '世界', ''].join('\n'))
  })

  it('strips inner <start ...>/<end ...> tag lines when original has none', () => {
    const original = 'A\nB\n'
    const translated = [
      'Here',
      '<start markdown>',
      'Keep this line',
      '<end markdown>',
      'End',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    expect(sanitized).to.eq(['Here', 'Keep this line', 'End', ''].join('\n'))
  })

  it('strips inner fence lines when original has none', () => {
    const original = 'A\nB\n'
    const translated = [
      'Here',
      '```ts',
      'const x = 1',
      '```',
      'End',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    expect(sanitized).to.eq(['Here', 'const x = 1', 'End', ''].join('\n'))
  })

  it('unwraps outer <start ...>/<end ...> wrapper but keeps inner tags when original already has tags', () => {
    const original = [
      'Text',
      '',
      '<start markdown>',
      'Inner',
      '<end markdown>',
      '',
      'End',
      ''
    ].join('\n')

    const translated = [
      '<start markdown>',
      'Text',
      '',
      '<start markdown>',
      'Inner',
      '<end markdown>',
      '',
      'End',
      '<end markdown>',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    const expected = [
      'Text',
      '',
      '<start markdown>',
      'Inner',
      '<end markdown>',
      '',
      'End'
    ].join('\n')
    expect(sanitized).to.eq(expected)
  })

  it('unwraps outer wrapper but keeps inner fences when original already has fences', () => {
    const original = [
      'Text',
      '',
      '```js',
      "console.log('hi')",
      '```',
      '',
      'End',
      ''
    ].join('\n')

    const translated = [
      '```markdown',
      'Text',
      '',
      '```js',
      "console.log('hi')",
      '```',
      '',
      'End',
      '```',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    const expected = [
      'Text',
      '',
      '```js',
      "console.log('hi')",
      '```',
      '',
      'End'
    ].join('\n')
    expect(sanitized).to.eq(expected)
  })

  it('does not unwrap when the original itself is fully wrapped', () => {
    const original = [
      '```js',
      "console.log('hi')",
      '```',
      ''
    ].join('\n')

    const translated = [
      '```js',
      "console.log('hi')",
      '```',
      ''
    ].join('\n')

    const sanitized = sanitizeUnexpectedCodeFences(original, translated)
    expect(sanitized).to.eq(translated)
  })
})

