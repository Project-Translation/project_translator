import { expect } from 'chai'
import { OperationCancelledError, isOperationCancelledError } from '../../runtime/errors'

describe('OperationCancelledError', () => {
  it('marks cancellation error with unified code', () => {
    const err = new OperationCancelledError('cancelled')
    expect(err.code).to.eq('E_OPERATION_CANCELLED')
    expect(isOperationCancelledError(err)).to.eq(true)
  })

  it('returns false for non-cancellation error', () => {
    expect(isOperationCancelledError(new Error('boom'))).to.eq(false)
  })
})
