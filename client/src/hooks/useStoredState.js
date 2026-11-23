import { useEffect, useState } from 'react'
import { readStored, writeStored } from '../lib/storage.js'

// useState kept in localStorage. `parse` turns the stored string (or null when
// nothing is stored / storage is unavailable) into the value; `serialize`
// turns the value back into a string, or null to remove the key.
export function useStoredState(key, parse, serialize = String) {
  const [value, setValue] = useState(() => parse(readStored(key)))
  useEffect(() => {
    writeStored(key, serialize(value))
    // serialize is expected to be a stable, pure function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value])
  return [value, setValue]
}
