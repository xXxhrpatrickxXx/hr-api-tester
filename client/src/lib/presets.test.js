import { describe, expect, it } from 'vitest'
import { BASES, PRESETS, loadState, resolveUrl, withResolvedUrls } from './presets.js'

describe('resolveUrl', () => {
  it('uses the base URL for the managed APIs', () => {
    expect(resolveUrl('search', '', BASES)).toBe(BASES.search)
  })

  it('appends the page key for Pages', () => {
    expect(resolveUrl('pages', 'abc', BASES)).toBe(`${BASES.pages}/abc`)
  })

  it('builds legacy URLs from the parameters, null while they do not parse', () => {
    expect(resolveUrl('legacySearch', '', BASES, '{"q":"x"}')).toBe(`${BASES.legacySearch}?format=json&q=x`)
    expect(resolveUrl('legacySearch', '', BASES, 'just words')).toBeNull()
  })

  it('leaves Custom empty', () => {
    expect(resolveUrl('custom', '', BASES)).toBe('')
  })
})

describe('loadState', () => {
  it('fills every solution with defaults', () => {
    const { preset, sessions } = loadState({})
    expect(preset).toBe('recommendations')
    expect(Object.keys(sessions)).toEqual(Object.keys(PRESETS))
    expect(sessions.search).toMatchObject({ method: 'POST', history: [], tab: 'tiles' })
  })

  it('keeps saved values over the defaults', () => {
    const { preset, sessions } = loadState({ preset: 'pages', sessions: { pages: { pagesKey: 'k', tab: 'json' } } })
    expect(preset).toBe('pages')
    expect(sessions.pages).toMatchObject({ pagesKey: 'k', tab: 'json', method: 'POST' })
  })

  it('lifts old legacy sessions that only kept a URL into the parameters editor', () => {
    const { sessions } = loadState({
      sessions: { legacySearch: { body: '', url: 'https://h/api?format=json&q=sko' } },
    })
    expect(JSON.parse(sessions.legacySearch.body)).toEqual({ q: 'sko' })
  })
})

describe('withResolvedUrls', () => {
  const { sessions } = loadState({})

  it('fills empty URLs and keeps Pages on its page key', () => {
    const out = withResolvedUrls({
      ...sessions,
      pages: { ...sessions.pages, pagesKey: 'k1', url: 'stale' },
    })
    expect(out.search.url).toBe(BASES.search)
    expect(out.pages.url).toBe(`${BASES.pages}/k1`)
    expect(out.legacySearch.url.startsWith(BASES.legacySearch)).toBe(true)
  })

  it('keeps URLs already set, and leaves Custom alone', () => {
    const out = withResolvedUrls({
      ...sessions,
      search: { ...sessions.search, url: 'https://example.com/mine' },
    })
    expect(out.search.url).toBe('https://example.com/mine')
    expect(out.custom).toBe(sessions.custom)
  })
})
