## 2025-05-15 - [Accessible Custom Interactive Elements]
**Learning:** Custom interactive elements like `<span>` with `role="button"` need explicit focus-visible styles and `e.preventDefault()` on keydown for Space/Enter to match native button behavior and prevent accidental page scrolling.
**Action:** Always include `focus-visible` ring utilities and call `e.preventDefault()` in keyboard event handlers for non-native interactive elements.

## 2025-05-15 - [Global Loading Visibility]
**Learning:** In a multi-app windowed system, users benefit from a persistent "Live" or loading indicator in the shared window frame (Title Bar) to understand that background streaming or tool execution is ongoing, regardless of individual app state.
**Action:** Implement shared state indicators in high-level layout components (like Window.tsx) to provide consistent system-wide feedback.
