import { expect } from 'chai'
import { formatVendorHttpErrorForPopup } from '../../services/vendorHttpError'

describe('formatVendorHttpErrorForPopup', () => {
  it('returns null when status is missing', () => {
    const res = formatVendorHttpErrorForPopup(new Error('boom'), { vendorName: 'test', operation: 'translate' })
    expect(res).to.eq(null)
  })

  it('formats message when status is present', () => {
    const err: any = { status: 429, error: { message: 'rate limit' } }
    const res = formatVendorHttpErrorForPopup(err, { vendorName: 'deepseek', model: 'deepseek-chat', operation: 'translate', sourcePath: '/a/b/c.md' })
    expect(res).to.not.eq(null)
    expect(res!.message).to.include('429')
    expect(res!.message).to.include('vendor=deepseek')
    expect(res!.message).to.include('rate limit')
  })

  it('extracts status from response.status', () => {
    const err: any = { response: { status: 401 }, message: 'Unauthorized' }
    const res = formatVendorHttpErrorForPopup(err, { vendorName: 'openai', operation: 'diff' })
    expect(res).to.not.eq(null)
    expect(res!.message).to.include('401')
  })
})

