## 2026-04-29 - UI Accessibility and Interaction Polish
**Learning:** Found that the app used extremely small font sizes (6px-8px) in the title bar and menu bar, which are below accessibility standards. Also identified that high-contrast green (bg-green-500) with white text fails WCAG contrast requirements (approx 2.3:1).
**Action:** Increased font sizes to at least 10px and adjusted container heights. Used `bg-green-100 text-green-800` for better contrast in feedback states.
