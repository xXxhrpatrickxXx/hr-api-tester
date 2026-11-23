import { describe, expect, it } from 'vitest'
import { buildLegacyUrl, fromQuery, paramsFromUrl, parseParams, toQuery } from './legacy.js'

describe('parseParams', () => {
  it('reads the JSON object from the API log', () => {
    expect(parseParams('{"ids": "1,2", "q": "x"}')).toEqual({ ids: '1,2', q: 'x' })
  })

  it('reads a query string or a full URL', () => {
    expect(parseParams('a=1&b[]=x&b[]=y')).toEqual({ a: '1', b: ['x', 'y'] })
    expect(parseParams('https://host/path?q=shoe&format=json')).toEqual({ q: 'shoe', format: 'json' })
    expect(parseParams('https://host/path')).toEqual({})
  })

  it('treats blank as no parameters', () => {
    expect(parseParams('  ')).toEqual({})
  })

  it('rejects anything else with a readable message', () => {
    expect(() => parseParams('[1, 2]')).toThrow()
    expect(() => parseParams('just words')).toThrow('expected a JSON object or a query string')
  })
})

describe('toQuery / fromQuery', () => {
  it('encodes arrays and nested objects jQuery.param style', () => {
    expect(toQuery({ ids: ['1', '2'], crawledData: { id: 'x' } })).toBe('ids[]=1&ids[]=2&crawledData[id]=x')
  })

  it('keeps brackets, commas, colons and slashes readable but escapes the rest', () => {
    expect(toQuery({ url: 'https://shop.dk/a b', ids: '1,2' })).toBe('url=https://shop.dk/a%20b&ids=1,2')
    expect(toQuery({ q: 'a&b=c' })).toBe('q=a%26b%3Dc')
  })

  it('round-trips through fromQuery', () => {
    const params = { q: 'red shoe', ids: ['1', '2'] }
    expect(fromQuery(toQuery(params))).toEqual(params)
  })
})

describe('buildLegacyUrl / paramsFromUrl', () => {
  it('puts format=json first unless given', () => {
    expect(buildLegacyUrl('https://h/api', { q: 'x' })).toBe('https://h/api?format=json&q=x')
    expect(buildLegacyUrl('https://h/api', { format: 'html', q: 'x' })).toBe('https://h/api?format=html&q=x')
  })

  it('reads parameters back without the default format', () => {
    expect(JSON.parse(paramsFromUrl('https://h/api?format=json&q=x'))).toEqual({ q: 'x' })
    expect(JSON.parse(paramsFromUrl(''))).toEqual({})
  })
})
