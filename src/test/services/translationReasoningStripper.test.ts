import { expect } from 'chai'
import { stripReasoningFromModelOutput } from '../../services/translationReasoningStripper'

describe('stripReasoningFromModelOutput', () => {
  it('removes <think>...</think> and keeps the remaining translation', () => {
    const raw = [
      '<think>',
      'some reasoning',
      '</think>',
      '',
      'Hello world',
      ''
    ].join('\n')

    const { text, didStrip } = stripReasoningFromModelOutput(raw)
    expect(didStrip).to.eq(true)
    expect(text).to.eq(['', 'Hello world', ''].join('\n'))
  })

  it('prefers the last <final>...</final> block when present', () => {
    const raw = [
      '<think>reasoning</think>',
      '<final>FIRST</final>',
      'noise',
      '<final>SECOND</final>'
    ].join('\n')

    const { text, didStrip } = stripReasoningFromModelOutput(raw)
    expect(didStrip).to.eq(true)
    expect(text).to.eq('SECOND')
  })

  it('does not return empty when stripping would remove everything', () => {
    const raw = [
      '<think>',
      'only reasoning',
      '</think>'
    ].join('\n')

    const { text, didStrip } = stripReasoningFromModelOutput(raw)
    expect(didStrip).to.eq(false)
    expect(text).to.eq(raw)
  })
})

