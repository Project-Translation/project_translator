import { expect } from 'chai'
import { SearchReplaceDiffApplier } from '../../services/searchReplaceDiffApplier'

describe('SearchReplaceDiffApplier', () => {
  it('applies single SEARCH/REPLACE block with start_line', () => {
    const original = [
      '{',
      '    "configuration.title": "项目翻译器",',
      '    "command.translateFolders": "翻译文件夹",',
      '    "command.translateFiles": "翻译文件",',
      '}',
      ''
    ].join('\n')

    const diff = [
      '<<<<<<< SEARCH',
      ':start_line: 3',
      '-------',
      '    "command.translateFiles": "翻译文件",',
      '=======',
      '    "command.translateFiles": "翻译文件（已更新）",',
      '>>>>>>> REPLACE',
      ''
    ].join('\n')

    const { updatedText, appliedCount } = SearchReplaceDiffApplier.apply(original, diff, { fuzzyThreshold: 1.0 })
    expect(appliedCount).to.eq(1)
    expect(updatedText).to.contain('翻译文件（已更新）')
  })

  it('ignores duplicate REPLACE markers and code fences', () => {
    const original = [
      '{',
      '    "command.translateProject": "翻译项目",',
      '}',
      ''
    ].join('\n')

    const diff = [
      '```json',
      '<<<<<<< SEARCH',
      ':start_line: 2',
      '-------',
      '    "command.translateProject": "翻译项目",',
      '=======',
      '    "command.translateProject": "翻译项目（新）",',
      '>>>>>>> REPLACE',
      '>>>>>>> REPLACE',
      '```',
      ''
    ].join('\n')

    const { updatedText, appliedCount } = SearchReplaceDiffApplier.apply(original, diff, { fuzzyThreshold: 1.0 })
    expect(appliedCount).to.eq(1)
    expect(updatedText).to.contain('翻译项目（新）')
  })
})


