<img src="./logo.png" alt="toy react logo" width="144" />

# Toy React

Rebuilding React from scratch to finally understand what's inside.

Started as a follow-along to [Build your own React](https://pomb.us/build-your-own-react/) and grew beyond "just adding types."

The goal wasn't to clone all of React – it was to get its core mechanics and design decisions right: fibers, lanes, scheduling, reconciliation – without the surface area of a production framework.

## What's implemented

- **Core API** – `createElement` / JSX
- **Hooks** – `useState`, `useEffect`
- **Reconciler**
  - Fiber tree, work loop – `performUnitOfWork`, `beginWork`, `completeUnitOfWork`
  - Lanes-based priority – `markUpdateLaneFromFiberToRoot`, `childLanes` bubbling
  - Fiber pooling – `getOrCreateWorkInProgressFiber`
  - Keyed reconciliation
  - Bailout optimization – two-tier (full skip + `cloneChildFibers`)
  - `memo`
- **Renderer (host config)** – `createDom`, `updateDom`, `commitRootFiber`
- **Scheduler** – `MessageChannel`-backed work loop (`performWorkUntilDeadline`, `scheduleWorkUntilDeadline`), 5ms time-slice budget

Some test coverage for reconciler, hooks, DOM output.

## Deliberate simplifications vs. real React

**Scheduler**

**No priority-reordering scheduler** – `scheduleWorkUntilDeadline` hands work
straight to MessageChannel. Real React's Scheduler keeps pending tasks in a
min-heap (`taskQueue`, `timerQueue`) sorted by an urgency deadline derived from priority — so a newer,
more urgent task can run before an older, less urgent one still waiting.

What problem min-heaps in real React solve:

- cross-root competition — two roots each schedule independently; only a
  shared heap can let a more urgent task from one root run before a less
  urgent, already-queued task from another
- high-prio tasks can jump ahead of already scheduled effect callback, but only before effect callback started executing
- the heap (specifically `timerQueue`) solves: delayed work that isn't eligible to run yet

## Credit

Structurally based on [pomber/didact](https://github.com/pomber/didact)
