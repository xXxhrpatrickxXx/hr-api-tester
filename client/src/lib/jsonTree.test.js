import { describe, expect, it } from 'vitest'
import { childPath, children, productOpenPaths, searchJson, splitMatches, summary } from './jsonTree.js'
import { getPath } from './products.js'

describe('childPath', () => {
  it('builds dot/bracket paths that getPath can read back', () => {
    const data = { products: { results: [{ title: 'Zion' }] } }
    const p = childPath(childPath(childPath(childPath('', 'products'), 'results'), 0, true), 'title')
    expect(p).toBe('products.results[0].title')
    expect(getPath(data, p)).toBe('Zion')
  })

  it('quotes keys that are not plain names', () => {
    expect(childPath('a', 'b.c', false)).toBe('a["b.c"]')
    expect(childPath('', 'with space', false)).toBe('["with space"]')
    expect(childPath('a', '42', false)).toBe('a.42')
  })
})

describe('children / summary', () => {
  it('lists entries with their paths', () => {
    expect(children([5, 6], 'x')).toEqual([
      [0, 5, 'x[0]'],
      [1, 6, 'x[1]'],
    ])
    expect(children({ a: 1 }, '')).toEqual([['a', 1, 'a']])
  })

  it('summarizes size', () => {
    expect(summary([1, 2, 3])).toBe('[3]')
    expect(summary({ a: 1, b: 2 })).toBe('{2}')
  })
})

describe('searchJson', () => {
  const data = {
    products: { results: [{ title: 'Zion shoe', price: 100 }, { title: 'Boot', price: 1999 }] },
    query: 'shoe',
  }

  it('finds keys and values, and opens the way to them', () => {
    const { hits, open, count } = searchJson(data, 'SHOE')
    expect([...hits].sort()).toEqual(['products.results[0].title', 'query'])
    expect(count).toBe(2)
    expect(open.has('')).toBe(true)
    expect(open.has('products')).toBe(true)
    expect(open.has('products.results')).toBe(true)
    expect(open.has('products.results[0]')).toBe(true)
    expect(open.has('products.results[1]')).toBe(false)
  })

  it('matches key names and numbers', () => {
    expect([...searchJson(data, 'price').hits]).toHaveLength(2)
    expect([...searchJson(data, '199').hits]).toEqual(['products.results[1].price'])
  })

  it('finds nothing for a blank query', () => {
    expect(searchJson(data, '  ').count).toBe(0)
  })
})

describe('splitMatches', () => {
  it('splits around every match, keeping the original case', () => {
    expect(splitMatches('Shoe shoe', 'shoe')).toEqual([
      { text: 'Shoe', match: true },
      { text: ' ', match: false },
      { text: 'shoe', match: true },
    ])
    expect(splitMatches('abc', '')).toEqual([{ text: 'abc', match: false }])
  })
})

describe('productOpenPaths', () => {
  it('opens the products array and the way to it', () => {
    const search = { products: { results: [{}] } }
    expect([...productOpenPaths(search, 'products.results')]).toEqual(['products', 'products.results'])
    expect([...productOpenPaths({ a: [{ b: [] }] }, 'a[0].b')]).toEqual(['a', 'a[0]', 'a[0].b'])
  })

  it('opens every box of a multi-box response', () => {
    const recoms = { responses: [{ products: [] }, { error: 'x' }, { products: [] }] }
    expect([...productOpenPaths(recoms, 'responses[].products')]).toEqual([
      'responses',
      'responses[0]',
      'responses[0].products',
      'responses[2]',
      'responses[2].products',
    ])
    const legacy = { result: { 'k-1': { result: [] }, k2: { result: [] } } }
    expect([...productOpenPaths(legacy, 'result[boxId].result')]).toEqual([
      'result',
      'result["k-1"]',
      'result["k-1"].result',
      'result.k2',
      'result.k2.result',
    ])
  })

  it('opens nothing without a products path', () => {
    expect(productOpenPaths({ a: 1 }, '').size).toBe(0)
    expect(productOpenPaths(null, 'a').size).toBe(0)
  })
})
