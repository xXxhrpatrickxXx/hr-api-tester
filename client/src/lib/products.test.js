import { describe, expect, it } from 'vitest'
import { extractResult, getPath, pageInfo, parseCountAfterSource, toTile } from './products.js'

const product = (n, extra = {}) => ({ productNumber: `P${n}`, title: `Product ${n}`, ...extra })

describe('getPath', () => {
  it('reads dot and bracket paths', () => {
    const obj = { a: { b: [{ c: 1 }, { c: 2 }] } }
    expect(getPath(obj, 'a.b[1].c')).toBe(2)
    expect(getPath(obj, 'a.x.y')).toBeUndefined()
    expect(getPath(obj, '')).toBe(obj)
  })
})

describe('toTile', () => {
  it('maps the standard fields and keeps the raw item', () => {
    const item = product(1, { imgUrl: 'i.jpg', price: 10, oldPrice: 12, url: 'u' })
    const t = toTile(item, undefined, 3)
    expect(t).toMatchObject({ id: 'P1', title: 'Product 1', image: 'i.jpg', price: 10, oldPrice: 12, url: 'u', pos: 3 })
    expect(t.raw).toBe(item)
  })

  it('flags AI synonym matches', () => {
    expect(toTile(product(1, { suggestedResult: true })).suggested).toBe(true)
    expect(toTile(product(1, { suggestedResult: false })).suggested).toBe(false)
    expect(toTile(product(1)).suggested).toBe(false)
  })

  it('reads the retail media campaign from the item or its trackingCode', () => {
    expect(toTile(product(1, { retailMediaCampaignId: 'abc12345' })).campaignId).toBe('abc12345')
    expect(toTile(product(1, { trackingCode: 'x|rm-cafe1234beef|y' })).campaignId).toBe('cafe1234beef')
    expect(toTile(product(1, { trackingCode: 'rm:deadbeef01' })).campaignId).toBe('deadbeef01')
    expect(toTile(product(1, { trackingCode: 'plain' })).campaignId).toBeUndefined()
  })

  it('uses the first banner image that has a url', () => {
    const t = toTile({
      isBanner: true,
      bannerImages: { wide: { url: '' }, grid: { url: 'g.png', width: 300, height: 200 } },
    })
    expect(t.isBanner).toBe(true)
    expect(t.image).toBe('g.png')
    expect(t.banner).toMatchObject({ placement: 'grid', width: 300 })
  })
})

describe('parseCountAfterSource', () => {
  it('parses each step and drops unparseable ones', () => {
    expect(parseCountAfterSource('0. FIXED (0ms): 0; 1. TOP_SELLERS (12ms): 3; junk')).toEqual([
      { index: 0, source: 'FIXED', ms: 0, count: 0 },
      { index: 1, source: 'TOP_SELLERS', ms: 12, count: 3 },
    ])
    expect(parseCountAfterSource('')).toEqual([])
    expect(parseCountAfterSource(undefined)).toEqual([])
  })
})

describe('extractResult', () => {
  it('picks Search products.results over a longer categories.results', () => {
    const res = {
      products: { results: [product(1), product(2)] },
      categories: { results: [{ title: 'c1', url: 'a' }, { title: 'c2', url: 'b' }, { title: 'c3', url: 'c' }] },
    }
    const { boxes, usedPath } = extractResult(res, '', undefined)
    expect(usedPath).toBe('products.results')
    expect(boxes[0].tiles.map((t) => t.id)).toEqual(['P1', 'P2'])
  })

  it('never treats a filters array as products', () => {
    const res = {
      products: {
        results: [product(1)],
        filters: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
      },
    }
    expect(extractResult(res, '', undefined).usedPath).toBe('products.results')
  })

  it('honours a manual products path', () => {
    const res = { data: { items: [product(7)] }, products: { results: [product(1)] } }
    const { boxes, usedPath } = extractResult(res, 'data.items', undefined)
    expect(usedPath).toBe('data.items')
    expect(boxes[0].tiles[0].id).toBe('P7')
  })

  it('splits multi-box recoms into boxes with their own steps', () => {
    const res = {
      responses: [
        { key: 'k1', products: [product(1), product(2)], countAfterSource: '0. A (1ms): 1; 1. B (2ms): 1' },
        { key: 'k2', products: [product(3)] },
      ],
    }
    const { boxes, usedPath } = extractResult(res, '', undefined)
    expect(usedPath).toBe('responses[].products')
    expect(boxes.map((b) => b.key)).toEqual(['k1', 'k2'])
    expect(boxes[0].tiles.map((t) => t.source.source)).toEqual(['A', 'B'])
  })

  it('does not count banners against a step', () => {
    const res = {
      responses: [
        {
          key: 'k',
          products: [product(1), { isBanner: true }, product(2), product(3)],
          countAfterSource: '0. A (1ms): 2; 1. B (1ms): 1',
        },
      ],
    }
    const [box] = extractResult(res, '', undefined).boxes
    const [p1, banner, p2, p3] = box.tiles
    expect(p1.source.source).toBe('A')
    expect(banner.source).toBeUndefined()
    expect(banner.step.source).toBe('A') // renders inside the step it sits in
    // Had the banner used up one of A's two slots, P2 would land in B.
    expect(p2.source.source).toBe('A')
    expect(p3.source.source).toBe('B')
  })

  it('reads legacy recoms as one box per box id', () => {
    const res = { result: { box1: { result: [product(1)] }, box2: { result: [product(2), product(3)] } } }
    const { boxes, usedPath } = extractResult(res, '', undefined)
    expect(usedPath).toBe('result[boxId].result')
    expect(boxes.map((b) => [b.key, b.tiles.length])).toEqual([['box1', 1], ['box2', 2]])
  })

  it('returns nothing for an empty response', () => {
    expect(extractResult(null, '', undefined)).toEqual({ boxes: [], usedPath: '' })
  })
})

describe('pageInfo', () => {
  it('reads Search, Pages and legacy Search paging', () => {
    expect(pageInfo({ products: { start: 20, totalCount: 90, results: [product(1), product(2)] } })).toEqual({ start: 20, shown: 2, total: 90 })
    expect(pageInfo({ products: { start: 0, total: 5, result: [product(1)] } })).toEqual({ start: 0, shown: 1, total: 5 })
    expect(pageInfo({ product_start: '10', product_results: 40, result: [product(1)] })).toEqual({ start: 10, shown: 1, total: 40 })
  })

  it('leaves banners out of the shown count', () => {
    const res = { products: { start: 0, total: 10, result: [product(1), { isBanner: true }, product(2)] } }
    expect(pageInfo(res).shown).toBe(2)
  })

  it('is null when there is no total (recoms)', () => {
    expect(pageInfo({ responses: [] })).toBeNull()
    expect(pageInfo(null)).toBeNull()
  })
})
