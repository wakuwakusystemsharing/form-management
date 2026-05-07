import { useEffect, useState } from 'react';

/**
 * 値の更新を指定ミリ秒だけ遅延させて返す汎用フック。
 * 連続更新時は最後の値だけが反映される。
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debouncedValue;
}
