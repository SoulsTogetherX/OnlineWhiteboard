//#region Imports
import { useCallback, type RefObject } from "react"

import { DEFAULT_COLOR_PALLET } from "@/constants/ui"
import { useSessionStorageRef } from "@/hooks/useSessionStorage"

import type {
  ColorType,
  ColorPallet,
  ColorPalletKeys,
} from "@shared/types/primitive"
//#endregion

//#region Type Def
export interface UseColorPaletteResult {
  colorPallet: RefObject<ColorPallet>
  setColor: (type: ColorPalletKeys, color: ColorType) => void
  swapColors: () => void
}
//#endregion

//#region Constants
const COLOR_PALLET_STORAGE_KEY = "online-whiteboard-color-pallet"
//#endregion

//#region Helper Defs
function cloneColorPallet(colorPallet: ColorPallet): ColorPallet {
  return {
    primary: { ...colorPallet.primary },
    secondary: { ...colorPallet.secondary },
  }
}

function isColorPallet(value: unknown): value is ColorPallet {
  if (!value || typeof value !== "object") {
    return false
  }
  const candidate = value as Partial<ColorPallet>
  return Boolean(candidate.primary && candidate.secondary)
}

function normalizeColorPallet(value: unknown): ColorPallet {
  return isColorPallet(value)
    ? cloneColorPallet(value)
    : cloneColorPallet(DEFAULT_COLOR_PALLET)
}
//#endregion

//#region Hook Def
export default function useColorPalette(): UseColorPaletteResult {
  const [colorPallet, setColorPallet] = useSessionStorageRef<ColorPallet>(
    COLOR_PALLET_STORAGE_KEY,
    normalizeColorPallet(DEFAULT_COLOR_PALLET),
    true,
  )

  const setColor = useCallback(
    (type: ColorPalletKeys, color: ColorType) => {
      const next = { ...colorPallet.current }
      next[type] = { ...color }

      console.log(colorPallet, next)
      setColorPallet(next)
    },
    [colorPallet, setColorPallet],
  )

  const swapColors = useCallback(() => {
    setColorPallet({
      primary: { ...colorPallet.current.secondary },
      secondary: { ...colorPallet.current.primary },
    })
  }, [colorPallet, setColorPallet])

  return {
    colorPallet,
    setColor,
    swapColors,
  }
}
//#endregion
