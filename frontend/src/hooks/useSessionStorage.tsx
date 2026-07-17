//#region Imports
import { useRef, useState } from "react"
//#endregion

//#region Helper Def
function getSessionValue<T>(key: string, default_val: T, useJson?: boolean): T {
  try {
    const value = sessionStorage.getItem(key)
    if (value === null) {
      return default_val
    } else if (useJson) {
      return JSON.parse(value)
    }

    return (value as T) ?? default_val
  } catch {
    return default_val
  }
}
function setSessionValue<T>(key: string, val: T, useJson?: boolean): void {
  try {
    if (useJson) {
      sessionStorage.setItem(key, JSON.stringify(val))
    } else if (typeof val === "string") {
      sessionStorage.setItem(key, val)
    }
  } catch {
    // Intentionally ignored. sessionStorage.setItem throws when storage is full
    // or blocked entirely (Safari private mode, cookies-disabled). Persistence
    // is a convenience here — the caller's in-memory state is still correct, so
    // failing to save must not break the app.
  }
}
//#endregion

//#region Hook Def
export function useSessionStorage<T = string>(
  key: string,
  default_val: T,
  useJson?: boolean,
): [T, (val: T) => void] {
  const [sessionState, setSessionState] = useState<T>(
    getSessionValue(key, default_val, useJson),
  )
  return [
    sessionState,
    (val: T) => {
      setSessionState(val)
      setSessionValue(key, val, useJson)
    },
  ]
}

export function useSessionStorageRef<T = string>(
  key: string,
  default_val: T,
  useJson?: boolean,
): [React.RefObject<T>, (val: T) => void] {
  const sessionState = useRef<T>(getSessionValue(key, default_val, useJson))
  return [
    sessionState,
    (val: T) => {
      sessionState.current = val
      setSessionValue(key, val, useJson)
    },
  ]
}
//#endregion
