## 2025-03-24 - High-Frequency LLM Stream Optimization
**Learning:** High-frequency data streaming (like LLM content) can cause "rendering storms" in React applications, leading to UI unresponsiveness and high CPU load. Updating state for every single chunk received from a stream is an anti-pattern when the stream rate exceeds the browser's refresh rate.
**Action:** Always throttle high-frequency state updates (e.g., once every 64ms or ~15 FPS) during streaming operations to preserve UI interactivity and reduce unnecessary re-renders.

## 2025-03-24 - Optimization of Content Caching Effects
**Learning:** Effects that depend on frequently changing content (like `llmContent` during a stream) will execute repeatedly if not properly guarded. If an effect's purpose is to persist or cache data once an operation is complete, it should only depend on a status flag (like `isLoading`) rather than the content itself.
**Action:** Remove volatile streaming content from `useEffect` dependency arrays when the effect logic is only required at the end of the streaming process.
