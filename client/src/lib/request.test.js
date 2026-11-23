import { describe, expect, it } from 'vitest'
import { hasContentType, pageRequest, responseError, sendsBody, withLogTag } from './request.js'

describe('withLogTag', () => {
  const HR = 'https://core.helloretail.com/serve/search'

  it('adds apiLogTag to Hello Retail URLs', () => {
    expect(withLogTag(HR, 'pl-test')).toBe(`${HR}?apiLogTag=pl-test`)
    expect(withLogTag(`${HR}?a=1`, 'pl test')).toBe(`${HR}?a=1&apiLogTag=pl%20test`)
  })

  it('leaves the URL alone when there is nothing to add', () => {
    expect(withLogTag(HR, '')).toBe(HR)
    expect(withLogTag(`${HR}?apiLogTag=mine`, 'other')).toBe(`${HR}?apiLogTag=mine`)
    expect(withLogTag('https://example.com/x', 'pl-test')).toBe('https://example.com/x')
    expect(withLogTag('not a url', 'pl-test')).toBe('not a url')
  })
})

describe('sendsBody / hasContentType', () => {
  it('only sends a non-empty body on methods that carry one', () => {
    expect(sendsBody('POST', '{}')).toBe(true)
    expect(sendsBody('POST', '  ')).toBe(false)
    expect(sendsBody('GET', '{}')).toBe(false)
    expect(sendsBody('HEAD', '{}')).toBe(false)
  })

  it('finds Content-Type in any case', () => {
    expect(hasContentType({ 'content-type': 'x' })).toBe(true)
    expect(hasContentType({ Accept: 'x' })).toBe(false)
  })
})

describe('pageRequest', () => {
  const body = (o) => JSON.stringify(o, null, 2)
  const paging = { start: 0, shown: 24, total: 100 }

  it('moves Search products.start by products.count', () => {
    const next = JSON.parse(pageRequest('search', body({ query: 'x', products: { start: 0, count: 10 } }), paging, 1))
    expect(next.products).toEqual({ start: 10, count: 10 })
    expect(next.firstLoad).toBeUndefined()
  })

  it('falls back to the number shown when there is no count, and never goes below 0', () => {
    const b = body({ products: {} })
    expect(JSON.parse(pageRequest('search', b, paging, 1)).products.start).toBe(24)
    expect(JSON.parse(pageRequest('search', b, { ...paging, start: 10 }, -1)).products.start).toBe(0)
  })

  it('sends firstLoad: false when paging Pages', () => {
    const next = JSON.parse(pageRequest('pages', body({ firstLoad: true, products: { count: 5 } }), paging, 1))
    expect(next.firstLoad).toBe(false)
    expect(next.products.start).toBe(5)
  })

  it('pages legacy Search through product_start, kept as a string', () => {
    const b = body({ q: 'x', product_count: '12', product_start: '0' })
    expect(JSON.parse(pageRequest('legacySearch', b, paging, 1)).product_start).toBe('12')
  })

  it('is null when the request has no offset to move', () => {
    expect(pageRequest('search', body({ query: 'x' }), paging, 1)).toBeNull()
    expect(pageRequest('legacySearch', body({ q: 'x' }), paging, 1)).toBeNull()
    expect(pageRequest('search', 'not json', paging, 1)).toBeNull()
    expect(pageRequest('search', body({ products: {} }), null, 1)).toBeNull()
  })
})

describe('responseError', () => {
  it('is null for a successful response', () => {
    expect(responseError({ ok: true, json: { success: true } })).toBeNull()
    expect(responseError(null)).toBeNull()
  })

  it('reads serve-endpoint errors from a non-2xx response', () => {
    const err = responseError({ ok: false, json: { success: false, code: 'BAD_KEY', message: 'Unknown key' } })
    expect(err).toMatchObject({ code: 'BAD_KEY', message: 'Unknown key' })
    expect(err.detail).toContain('BAD_KEY')
  })

  it('catches legacy errors sent with HTTP 200', () => {
    expect(responseError({ ok: true, json: { error: 'No such box', errorCode: 4 } })).toMatchObject({
      code: 4,
      message: 'No such box',
    })
  })

  it('falls back to the raw text when the body is not JSON', () => {
    expect(responseError({ ok: false, json: null, text: 'Bad gateway' })).toMatchObject({ message: null, detail: 'Bad gateway' })
  })
})
