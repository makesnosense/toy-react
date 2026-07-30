<img src="./logo.png" alt="toy react logo" width="120" />

# Toy React

Rebuilding React from scratch to finally understand what's inside.

Started as a follow-along to [Build your own React](https://pomb.us/build-your-own-react/) and grew beyond "just adding types."

The goal wasn't to clone all of React – it was to get its core mechanics and design decisions right: fibers, lanes, scheduling, reconciliation – without the surface area of a production framework.

## What's implemented

- **Core API** – `createElement` / JSX
- **Hooks** – `useState`
- **Reconciler**
  - Fiber tree, work loop – `performUnitOfWork`, `beginWork`, `completeUnitOfWork`
  - Lanes-based priority – `markUpdateLaneFromFiberToRoot`, `childLanes` bubbling
  - Fiber pooling – `getOrCreateWorkInProgressFiber`
  - Keyed reconciliation
- **Renderer (host config)** – `createDom`, `updateDom`, `commitRootFiber`
- **Scheduler** – `MessageChannel`-backed work loop (`performWorkUntilDeadline`, `scheduleWorkUntilDeadline`), 5ms time-slice budget

Some test coverage for reconciler, hooks, DOM output.

## Planned

- Effects (`useEffect`)
- memo

## Credit

Structurally based on [pomber/didact](https://github.com/pomber/didact)
