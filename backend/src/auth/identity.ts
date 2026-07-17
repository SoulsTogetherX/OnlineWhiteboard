//#region Identity helpers
// A person in a room needs a display name and a colour, whether they're a
// registered user or an anonymous guest. Registered users get a colour assigned
// at sign-up; guests get both generated per connection. Kept in one place so
// both paths draw from the same palette and the presence roster looks coherent.
//#endregion

//#region Palette
// A hand-picked set of distinct, legible colours (Sasha Trubetskoy's 20-colour
// palette, trimmed). Distinct hues matter here: they're how you tell two
// cursors apart at a glance.
const IDENTITY_COLORS = [
  "#e6194b", "#3cb44b", "#4363d8", "#f58231", "#911eb4",
  "#42d4f4", "#f032e6", "#bfef45", "#fabed4", "#469990",
  "#dcbeff", "#9a6324", "#800000", "#808000", "#000075",
  "#e6820e",
]

export function randomIdentityColor(): string {
  const index = Math.floor(Math.random() * IDENTITY_COLORS.length)
  return IDENTITY_COLORS[index]
}
//#endregion

//#region Guest names
const GUEST_ADJECTIVES = [
  "Swift", "Calm", "Bright", "Bold", "Quiet", "Clever", "Brave", "Gentle",
  "Merry", "Keen", "Lucky", "Nimble",
]
const GUEST_ANIMALS = [
  "Otter", "Finch", "Fox", "Heron", "Lynx", "Wren", "Ibex", "Marten",
  "Falcon", "Badger", "Robin", "Hare",
]

// e.g. "Swift Otter". Purely cosmetic and not unique — the connection id is what
// actually identifies a guest; this is just a friendly label for the roster.
export function randomGuestName(): string {
  const adjective =
    GUEST_ADJECTIVES[Math.floor(Math.random() * GUEST_ADJECTIVES.length)]
  const animal = GUEST_ANIMALS[Math.floor(Math.random() * GUEST_ANIMALS.length)]
  return `${adjective} ${animal}`
}
//#endregion
