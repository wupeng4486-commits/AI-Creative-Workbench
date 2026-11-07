import { useEffect, useState } from "react";

export function readPersisted<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`aiw.${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** UI state that survives navigation, refresh and browser restarts. */
export function usePersisted<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => readPersisted(key, fallback));
  useEffect(() => {
    try {
      window.localStorage.setItem(`aiw.${key}`, JSON.stringify(value));
    } catch {
      // Storage may be unavailable in private mode; state still works.
    }
  }, [key, value]);
  return [value, setValue] as const;
}
