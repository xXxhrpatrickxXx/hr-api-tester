import { memo, useState } from 'react'
import { fieldText, groupTilesByStep, stepKey } from '../lib/display.js'
import { getPath } from '../lib/products.js'
import { CopyButton } from './CopyButton.jsx'

// Render a box's tiles: grouped by countAfterSource step (bordered/colored) when
// step data exists and grouping is on, otherwise a plain grid.
export function TileGroups({ tiles, steps, grouped, colors, extra }) {
  if (grouped && steps.length > 0) {
    return (
      <div className="stepgroups">
        {groupTilesByStep(tiles).map((g, gi) => {
          const color = g.source ? colors[stepKey(g.source)] : 'var(--border)'
          return (
            <div key={`${g.key}-${gi}`} className="stepgroup" style={{ borderColor: color }}>
              <div className="stephead" style={{ background: color }}>
                {(() => {
                  const banners = g.tiles.filter((t) => t.isBanner).length
                  const products = g.tiles.length - banners
                  // Banners aren't part of countAfterSource, so keep them out
                  // of the step's product count rather than inflating it.
                  const extra = banners ? ` +${banners} banner${banners > 1 ? 's' : ''}` : ''
                  return g.source
                    ? `Step ${g.source.index}: ${g.source.source} · ${g.source.ms}ms · ${products}${extra}`
                    : `Unattributed · ${products}${extra}`
                })()}
              </div>
              <div className="stepbody">
                {g.tiles.map((t, i) => (
                  <Tile key={t.id ?? `${gi}-${i}`} t={t} extra={extra} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="grid">
      {tiles.map((t, i) => (
        <Tile key={t.id ?? i} t={t} extra={extra} />
      ))}
    </div>
  )
}

// Memoized: any App state change (typing, filtering, resizing) re-renders the
// whole tree, and a response can hold hundreds of tiles. Tile props are stable
// object refs, so this skips nearly all of that reconciliation.
const Tile = memo(function Tile({ t, extra }) {
  const [open, setOpen] = useState(false)
  // `fields` often omits title (and banners have none), so fall back to the
  // banner's alt text, then the product number, before giving up.
  const label =
    t.title ||
    t.banner?.altText ||
    (t.isBanner ? 'Retail media banner' : t.id ? String(t.id) : '(untitled)')
  return (
    <div className={t.isBanner ? 'tile banner' : t.campaignId ? 'tile sponsored' : 'tile'}>
      <div className="thumb">
        {/* Position in the response, so filtered views still show the original
            ordering (e.g. #1, #5, #18, #72). */}
        {t.pos != null && (
          <span className="pos" title={`Position #${t.pos} in the response`}>#{t.pos}</span>
        )}
        {(t.isBanner || t.campaignId || t.suggested) && (
          <span className="tags">
            {t.isBanner ? (
              <span className="btag" title={`Retail media campaign ${t.campaignId || '(unknown)'}`}>
                banner
              </span>
            ) : t.campaignId ? (
              <span className="stag" title={`Retail media campaign ${t.campaignId}`}>sponsored</span>
            ) : null}
            {t.suggested && (
              <span
                className="atag"
                title="Matched only through AI synonym expansion (suggestedResult), not the query itself"
              >
                AI match
              </span>
            )}
          </span>
        )}
        {t.image ? (
          <img src={t.image} alt={t.banner?.altText || t.title || ''} loading="lazy" />
        ) : (
          <div className="noimg">{t.isBanner ? 'no banner image' : 'no image'}</div>
        )}
      </div>
      <div className="meta">
        <div className="title" title={label}>{label}</div>
        {t.isBanner ? (
          <div className="bmeta">
            {t.banner
              ? `${t.banner.placement} · ${t.banner.width}×${t.banner.height}`
              : 'no artwork'}
            {t.campaignId ? ` · ${t.campaignId}` : ''}
          </div>
        ) : (
          <div className="prices">
            {t.price != null && <span className="price">{String(t.price)}</span>}
            {t.oldPrice != null && <span className="old">{String(t.oldPrice)}</span>}
          </div>
        )}
        {!t.isBanner && extra?.length > 0 && (
          <div className="xfields">
            {extra.map((f) => {
              const v = fieldText(getPath(t.raw, f))
              return (
                <div className="xf" key={f} title={`${f}: ${v}`}>
                  <span className="xk">{f}</span>
                  <span className="xv">{v}</span>
                </div>
              )
            })}
          </div>
        )}
        <div className="row">
          {t.url && (
            <a className="link" href={t.url} target="_blank" rel="noreferrer">open</a>
          )}
          <button className="link" onClick={() => setOpen((v) => !v)}>
            {open ? 'hide' : 'raw'}
          </button>
          {open && (
            <CopyButton
              className="link"
              label="copy"
              title="Copy this item's JSON"
              text={() => JSON.stringify(t.raw, null, 2)}
            />
          )}
        </div>
        {open && <pre className="code view sm">{JSON.stringify(t.raw, null, 2)}</pre>}
      </div>
    </div>
  )
})
