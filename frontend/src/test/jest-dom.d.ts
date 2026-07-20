// The jest-dom matchers are registered at runtime by vitest.setup.ts, but that
// setup file lives outside `src` and so is invisible to `tsc`. This side-effect
// import lives under `src` (which tsconfig.app.json compiles) purely to pull the
// `declare module "vitest"` augmentation into the typecheck, so `.test.tsx`
// files see toBeInTheDocument/toHaveTextContent as typed matchers.
import "@testing-library/jest-dom/vitest"
