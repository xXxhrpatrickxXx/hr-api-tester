import { describe, expect, it } from 'vitest'
import {
  REDACTED,
  buildExport,
  buildSummary,
  entrySummary,
  matchesHistory,
  mergeImport,
  redactHeaders,
} from './history.js'

describe('buildSummary', () => {
  it('labels an entry from its request', () => {
    expect(buildSummary({ body: '{"query":"shoe"}' })).toBe('“shoe”')
    expect(buildSummary({ body: '{"q":"sko"}' })).toBe('“sko”')
    expect(buildSummary({ body: '{"boxId":"abc"}' })).toBe('box abc')
    expect(buildSummary({ body: '{"url":"https://shop.dk/c"}' })).toBe('shop.dk/c')
  })

  it('falls back to the page key, then the method', () => {
    expect(buildSummary({ body: '{}', pagesKey: 'pk', method: 'POST' })).toBe('pk')
    expect(buildSummary({ body: 'not json', method: 'POST' })).toBe('POST')
  })

  it('reads old legacy entries that only have a URL', () => {
    expect(buildSummary({ url: 'https://h/api?format=json&q=sko', method: 'GET' })).toBe('“sko”')
  })

  it('prefers the summary stored on the entry', () => {
    expect(entrySummary({ summary: 'stored', body: '{"query":"x"}' })).toBe('stored')
  })
})

describe('matchesHistory', () => {
  const entry = { note: 'Before boost', body: '{"query":"shoe"}', url: 'https://h/serve/search', resp: { status: 404 } }

  it('matches note, query, URL and status', () => {
    for (const q of ['boost', 'shoe', 'serve/search', '404']) expect(matchesHistory(entry, q)).toBe(true)
    expect(matchesHistory(entry, 'sandal')).toBe(false)
  })
})

describe('export / import', () => {
  const e = (id, ts) => ({ id, ts, method: 'POST' })
  const sessions = { search: { history: [e('a', 3), e('b', 1)] }, pages: { history: [] } }

  it('exports every solution', () => {
    const data = buildExport(sessions, new Date('2026-11-10T08:00:00Z'))
    expect(data).toMatchObject({ app: 'hr-api-tester', version: 1, exportedAt: '2026-11-10T08:00:00.000Z' })
    expect(data.history.search.map((h) => h.id)).toEqual(['a', 'b'])
  })

  it('redacts credential headers on export, keeping the rest', () => {
    const headers = JSON.stringify(
      {
        'Content-Type': 'application/json',
        Authorization: 'Bearer abc123',
        'x-api-key': 'k-1',
        'X-Auth-Token': 'with \\"quote\\"',
        'x-hr-key': 42,
      },
      null,
      2,
    )
    const data = buildExport({ search: { history: [{ ...e('a', 1), headers, body: '{"key":"stays"}' }] } })
    const out = data.history.search[0]
    const parsed = JSON.parse(out.headers)
    expect(parsed['Content-Type']).toBe('application/json')
    expect(parsed.Authorization).toBe(REDACTED)
    expect(parsed['x-api-key']).toBe(REDACTED)
    expect(parsed['X-Auth-Token']).toBe(REDACTED)
    expect(parsed['x-hr-key']).toBe(REDACTED)
    expect(out.body).toBe('{"key":"stays"}')
    // The entry in the app itself is untouched.
    expect(headers).toContain('abc123')
  })

  it('redacts even when the headers JSON is broken', () => {
    const out = redactHeaders('{\n  "Authorization": "Bearer abc",\n  "Accept": "x"')
    expect(out).not.toContain('abc')
    expect(out).toContain('"Accept": "x"')
  })

  it('merges new entries newest first and skips ones already there', () => {
    const data = { app: 'hr-api-tester', history: { search: [e('a', 3), e('c', 2)], pages: [e('p', 1)] } }
    const { sessions: next, added } = mergeImport(sessions, data, 100)
    expect(added).toBe(2)
    expect(next.search.history.map((h) => h.id)).toEqual(['a', 'c', 'b'])
    expect(next.pages.history.map((h) => h.id)).toEqual(['p'])
    expect(mergeImport(next, data, 100).added).toBe(0)
  })

  it('keeps only the newest `max` entries', () => {
    const data = { app: 'hr-api-tester', history: { search: [e('c', 2), e('d', 4)] } }
    expect(mergeImport(sessions, data, 2).sessions.search.history.map((h) => h.id)).toEqual(['d', 'a'])
  })

  it('ignores unknown solutions and malformed entries', () => {
    const data = { app: 'hr-api-tester', history: { gone: [e('x', 1)], search: [{ id: 'no-ts' }, null] } }
    expect(mergeImport(sessions, data, 100).added).toBe(0)
  })

  it('rejects files that are not an export', () => {
    expect(() => mergeImport(sessions, { history: {} }, 100)).toThrow()
    expect(() => mergeImport(sessions, null, 100)).toThrow()
  })
})
