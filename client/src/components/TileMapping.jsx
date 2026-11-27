import { useMemo, useState } from 'react'
import { DEFAULT_FIELD_MAP, findArrayPaths } from '../lib/products.js'

// Where the products are in the response and which of their fields fill a
// tile, for responses the auto-detection gets wrong. `onPatch` changes the
// solution's session.
export function TileMapping({ productsPath, fieldMap, tileFields, payload, onPatch }) {
  // Array paths are only looked for while the panel is actually open.
  const [open, setOpen] = useState(false)
  const arrayPaths = useMemo(() => (open && payload ? findArrayPaths(payload) : []), [open, payload])

  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Tile mapping</summary>
      <label className="lbl" htmlFor="products-path">Products array path (blank = auto-detect)</label>
      <input
        id="products-path"
        className="url"
        value={productsPath}
        placeholder="e.g. response.products"
        onChange={(e) => onPatch({ productsPath: e.target.value })}
      />
      {arrayPaths.length > 0 && (
        <div className="paths">
          {arrayPaths.slice(0, 6).map((p) => (
            <button key={p.path} className="chip sm" onClick={() => onPatch({ productsPath: p.path })}>
              {p.path || '(root)'} · {p.length}
            </button>
          ))}
        </div>
      )}
      {Object.keys(DEFAULT_FIELD_MAP).map((f) => (
        <div className="row" key={f}>
          <label className="fname" htmlFor={`field-${f}`}>{f}</label>
          <input
            id={`field-${f}`}
            className="url"
            value={fieldMap[f] || ''}
            onChange={(e) => onPatch({ fieldMap: { ...fieldMap, [f]: e.target.value } })}
          />
        </div>
      ))}
      <label className="lbl" htmlFor="tile-fields">Extra fields on tiles (comma-separated, dot paths ok)</label>
      <input
        id="tile-fields"
        className="url"
        value={tileFields || ''}
        placeholder="e.g. inStock, brand, extraData.color"
        onChange={(e) => onPatch({ tileFields: e.target.value })}
      />
    </details>
  )
}
