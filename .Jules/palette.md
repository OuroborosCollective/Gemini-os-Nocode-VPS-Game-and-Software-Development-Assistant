## 2026-04-27 - [Keyboard Accessibility & ARIA Status]
**Learning:** Interactive elements implemented as `<span>` (common in this repo's "Nano Architecture") require explicit `focus-visible` styles and `e.preventDefault()` in `onKeyDown` to behave correctly for keyboard users. Visual-only status indicators (like connection dots) must have `role="status"` and `aria-label` to be accessible.
**Action:** When creating or modifying button-like elements or status indicators, always ensure they have proper ARIA attributes, keyboard listeners with event prevention, and visible focus indicators.
