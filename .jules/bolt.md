## 2025-03-24 - High-Frequency LLM Stream Optimization
**Learning:** High-frequency data streaming (like LLM content) can cause "rendering storms" in React applications, leading to UI unresponsiveness and high CPU load. Updating state for every single chunk received from a stream is an anti-pattern when the stream rate exceeds the browser's refresh rate.
**Action:** Always throttle high-frequency state updates (e.g., once every 64ms or ~15 FPS) during streaming operations to preserve UI interactivity and reduce unnecessary re-renders.

## 2025-03-24 - Optimization of Content Caching Effects
**Learning:** Effects that depend on frequently changing content (like `llmContent` during a stream) will execute repeatedly if not properly guarded. If an effect's purpose is to persist or cache data once an operation is complete, it should only depend on a status flag (like `isLoading`) rather than the content itself.
**Action:** Remove volatile streaming content from `useEffect` dependency arrays when the effect logic is only required at the end of the streaming process.

## 2025-03-24 - Root-Level Polling Re-renders
**Learning:** Placing health check polling or any frequent background state updates at the root level (`App.tsx`) causes the entire component tree to re-render, even if the state is only consumed by a specific sub-component.
**Action:** Always localize polling state to the specific component that renders it (e.g., `Window.tsx`) to isolate re-renders and preserve application performance.

## 2025-03-24 - Callback Stability with Latest Ref Pattern
**Learning:** Memoized components (`React.memo`) still re-render if their callback props change. In a complex app like this, callbacks often depend on frequently changing state (interaction history, cache, etc.), causing them to be recreated every render.
**Action:** Use the "Latest Ref" pattern in `App.tsx` to keep callbacks stable by accessing volatile state through refs instead of dependency arrays. This allows leaf components like `Icon` and `GeneratedContent` to truly benefit from memoization.
