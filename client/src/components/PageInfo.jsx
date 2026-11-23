// Thousands grouped with a narrow no-break space (1 240), so the separator
// reads as whitespace but never wraps mid-number.
const groupDigits = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

// "Showing 51–60 of 206 results" for a Search / Pages response; `start` is the
// 0-based offset, so the first product shown is start + 1. Nothing when the
// response has no products (the "No products found" notice covers that).
// `onPage(dir)` sends the previous/next page; null when the request can't be
// paged (no offset in its body).
export function PageInfo({ start, shown, total, onPage, busy }) {
  if (shown === 0) return null
  const first = start + 1
  const last = start + shown
  return (
    <div className="pageinfo">
      <span>
        Showing <b>{groupDigits(first)}{last > first ? `–${groupDigits(last)}` : ''}</b> of{' '}
        <b>{groupDigits(total)}</b> result{total === 1 ? '' : 's'}
      </span>
      {onPage && (
        <span className="pager">
          <button className="chip sm" disabled={busy || start <= 0} onClick={() => onPage(-1)}>
            ‹ prev
          </button>
          <button className="chip sm" disabled={busy || last >= total} onClick={() => onPage(1)}>
            next ›
          </button>
        </span>
      )}
    </div>
  )
}
