//#region Imports
import "./styles.css"
//#endregion

//#region Types
// Buttons are grouped by what they MEAN, not by what they look like. Picking a
// variant is a statement about the action's weight, and the appearance follows —
// which is what stops a "make this one stand out" instinct from inventing a
// fifth colour scheme in some corner of the app.
//
//   primary   — the one action a surface exists for. Filled accent. At most one
//               per view; two primaries is the same as none.
//   secondary — the default. Everything that is a normal, reversible action.
//   promoted  — inviting but not the point of the screen: accent outline, no
//               fill. Claiming a room, asking for editor access.
//   danger    — destructive and hard to undo. Outlined in the danger colour
//               rather than filled, so it reads as a warning instead of
//               competing with the primary action for attention.
export type ButtonVariant = "primary" | "secondary" | "promoted" | "danger"

// Two sizes only. A third would be someone's one-off spacing tweak wearing a
// size's clothes.
export type ButtonSize = "sm" | "md"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  // Stretches to the container. Common enough in the stacked sidebar panels to
  // be worth a prop rather than a wrapper class at each call site.
  fullWidth?: boolean
}
//#endregion

//#region Component Def
// The app's one button.
//
// Before this existed, nine stylesheets each grew their own: four different
// disabled opacities, three border radii, five paddings, some with a pressed
// state and some without, and one whose hover was a hardcoded translucent black
// that simply did not show up in dark mode. They all looked deliberate in
// isolation and inconsistent side by side.
//
// The states are the reason it is a component and not a shared class. Hover,
// press, disabled and focus are four rules that must agree with each other, and
// re-typing them by hand is how they drift — the pressed state in particular was
// missing far more often than it was present, so half the buttons felt dead
// under the pointer.
//
// `type` defaults to "button". The HTML default is "submit", which inside a form
// makes an unrelated button silently submit it — a bug that looks like a routing
// problem and is one attribute.
export default function Button({
  variant = "secondary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [
    "btn",
    `btn-${variant}`,
    `btn-${size}`,
    fullWidth ? "btn-block" : "",
    // Appended last so a caller can still add layout (margins, grid placement)
    // without fighting the variant. Appearance belongs to the variant; where the
    // button SITS belongs to the caller.
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ")

  return <button type={type} className={classes} {...rest} />
}
//#endregion
