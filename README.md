# Toy React

Rebuilding React from scratch to finally understand what is there under the hood.

Started as a follow-along to [Build your own React](https://pomb.us/build-your-own-react/).

## Beyond the tutorial

- Added TypeScript types throughout
- Scheduler backed by `MessageChannel` (with `setImmediate`/`setTimeout` fallback)
- Lanes-based priority model (`LANE` bitmask, `lanes`/`childLanes` on fibers)
- Fiber pooling (`getOrCreateWorkInProgressFiber`) instead of a fresh tree per render
- Keyed reconciliation with a two-pass, map-based diff
- Vitest + jsdom test suite

## Planned

- Effects (`useEffect`)
- memo

## Credit

Structurally based on [pomber/didact](https://github.com/pomber/didact) (MIT).
See `LICENSE`.
