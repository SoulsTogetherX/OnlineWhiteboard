//#region Imports
import { useEffect, useState } from "react"
//#endregion

//#region Constants
const SESSION_ID_STORAGE_KEY = "online-whiteboard-session-id"
//#endregion

//#region Helper Defs
function getSessionID(): string {
  const savedID = localStorage.getItem(SESSION_ID_STORAGE_KEY)

  if (savedID) {
    return savedID
  } else {
    const newID = crypto.randomUUID()
    localStorage.setItem(SESSION_ID_STORAGE_KEY, newID)
    return newID
  }
}
//#endregion

//#region Hook Def
export default function useSessionID(): string {
  const [clientID, setClientID] = useState<string>(getSessionID)

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      // Was comparing against the literal "client_uuid", which is not the key
      // this hook ever writes (see SESSION_ID_STORAGE_KEY above). The condition
      // could never be true, so cross-tab session sync silently never ran.
      if (e.key === SESSION_ID_STORAGE_KEY) {
        if (e.newValue) {
          setClientID(e.newValue)
          return
        }
        // The id was cleared in another tab — mint a new one and write it back
        // so every tab converges on the same value again.
        const newID = crypto.randomUUID()
        localStorage.setItem(SESSION_ID_STORAGE_KEY, newID)
        setClientID(newID)
      }
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [])

  return clientID
}
//#endregion
