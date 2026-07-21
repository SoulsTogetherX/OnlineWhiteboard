//#region Imports
import { useCallback, type RefObject } from "react"

import { DEFAULT_COLOR_PALETTE } from "@/constants/ui"
import { useSessionStorageRef } from "@/hooks/useSessionStorage"

import type {
  ColorType,
  ColorPalette,
  ColorPaletteKeys,
} from "@shared/types/primitive"
//#endregion

//#region Type Def
export interface UseColorPaletteResult {
  colorPalette: RefObject<ColorPalette>
  setColor: (type: ColorPaletteKeys, color: ColorType) => void
  swapColors: () => void
}
//#endregion

//#region Constants
// NOTE the deliberate spelling mismatch. The identifier was corrected to
// PALETTE, but the stored key string is still "...-color-pallet" — and must
// stay that way. It is a live sessionStorage key: renaming the VALUE would
// orphan every existing user's saved primary/secondary colours the next time
// they load the app. Renaming an identifier is free; renaming persisted data is
// a migration. Leave the string alone.
const COLOR_PALETTE_STORAGE_KEY = "online-whiteboard-color-pallet"
//#endregion

//#region Helper Defs
function cloneColorPalette(colorPalette: ColorPalette): ColorPalette {
  return {
    primary: { ...colorPalette.primary },
    secondary: { ...colorPalette.secondary },
  }
}

function isColorPalette(value: unknown): value is ColorPalette {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Partial<ColorPalette>
  return Boolean(candidate.primary && candidate.secondary)
}

function normalizeColorPalette(value: unknown): ColorPalette {
  return isColorPalette(value)
    ? cloneColorPalette(value)
    : cloneColorPalette(DEFAULT_COLOR_PALETTE)
}
//#endregion

//#region Hook Def
export default function useColorPalette(): UseColorPaletteResult {
  const [colorPalette, setColorPalette] = useSessionStorageRef<ColorPalette>(
    COLOR_PALETTE_STORAGE_KEY,
    normalizeColorPalette(DEFAULT_COLOR_PALETTE),
    true,
  )

  const setColor = useCallback(
    (type: ColorPaletteKeys, color: ColorType) => {
      const next = { ...colorPalette.current }
      next[type] = { ...color }

      setColorPalette(next)
    },
    [colorPalette, setColorPalette],
  )

  const swapColors = useCallback(() => {
    setColorPalette({
      primary: { ...colorPalette.current.secondary },
      secondary: { ...colorPalette.current.primary },
    })
  }, [colorPalette, setColorPalette])

  return {
    colorPalette,
    setColor,
    swapColors,
  }
}
//#endregion
