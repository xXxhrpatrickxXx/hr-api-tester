import { useMemo } from 'react'
import { extractResult, pageInfo } from '../lib/products.js'
import { responseError } from '../lib/request.js'

// What a response holds, read once per response: the API error (if any), the
// products as one or more "boxes" (recoms can request several at once — each
// responses[] entry is its own box with its own step waterfall), and, for
// Search / Pages, which slice of the full result set this is.
export function useResult(resp, productsPath, fieldMap) {
  const payload = resp?.json
  const apiError = useMemo(() => responseError(resp), [resp])
  const { boxes, usedPath } = useMemo(
    () => extractResult(payload, productsPath, fieldMap),
    [payload, productsPath, fieldMap],
  )
  const paging = useMemo(() => pageInfo(payload), [payload])
  const allTiles = useMemo(() => boxes.flatMap((b) => b.tiles), [boxes])
  return { payload, apiError, boxes, usedPath, paging, allTiles }
}
