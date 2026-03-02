import { expect } from 'chai'
import { normalizeConfigData } from '../../config/config.normalize'

describe('normalizeConfigData', () => {
  it('prefers flat key over projectTranslator.* key', () => {
    const config = normalizeConfigData({
      currentVendor: 'flat-vendor',
      'projectTranslator.currentVendor': 'prefixed-vendor',
      vendors: [
        {
          name: 'flat-vendor',
          apiEndpoint: 'https://example.com/v1',
          model: 'test-model',
        },
      ],
    })

    expect(config.currentVendorName).to.eq('flat-vendor')
  })

  it('normalizes vendor env var name when missing', () => {
    const config = normalizeConfigData({
      currentVendor: 'my-vendor',
      vendors: [
        {
          name: 'my-vendor',
          apiEndpoint: 'https://example.com/v1',
          model: 'm',
        },
      ],
    })

    expect(config.currentVendor.apiKeyEnvVarName).to.eq('MY_VENDOR_API_KEY')
  })
})
