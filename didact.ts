export type ObjectValues<T> = T[keyof T];

// how long a work-loop pass may run before yielding back to the host, in
// milliseconds — mirrors the frame budget react's own scheduler uses
const WORK_LOOP_FRAME_BUDGET_MS = 5;

// picks the fastest reliable "run this on the next task" primitive
// available: setImmediate in node (unlike MessageChannel, it doesn't hold
// the process open, and it fires earlier when both are available);
// MessageChannel in browsers (postMessage delivery is always async, even
// same-thread, and unlike setTimeout isn't subject to the 4ms nested-call
// clamp); setTimeout as a last resort.
let scheduleWorkUntilDeadline: (performWorkUntilDeadline: () => void) => void;

if ("setImmediate" in globalThis) {
  const nodeSetImmediate = (
    globalThis as unknown as { setImmediate: (callback: () => void) => void }
  ).setImmediate;
  scheduleWorkUntilDeadline = (performWorkUntilDeadline) =>
    nodeSetImmediate(performWorkUntilDeadline);
} else if ("MessageChannel" in globalThis) {
  const workLoopChannel = new MessageChannel();
  scheduleWorkUntilDeadline = (performWorkUntilDeadline) => {
    workLoopChannel.port1.onmessage = () => performWorkUntilDeadline();
    workLoopChannel.port2.postMessage(null);
  };
} else {
  scheduleWorkUntilDeadline = (performWorkUntilDeadline) =>
    setTimeout(performWorkUntilDeadline, 0);
}

type DidactFunctionComponent = (props: DidactElementProps) => DidactElement;

interface DidactElement {
  type: string | DidactFunctionComponent;
  key: string | number | null;
  props: DidactElementProps;
}

interface DidactElementProps {
  [key: string]: unknown;
  children: DidactElement[];
}
// names the category "a thing that can occupy a renderable position"
// agnostic to whether the specific instance is object-shaped or primitive-shaped.
type DidactNode = DidactElement | string | number;

const ROOT_FIBER_TYPE = "ROOT_FIBER";

interface Fiber {
  type: DidactElement["type"];
  key: string | number | null;
  index: number;
  props: DidactElementProps;
  dom: HTMLElement | Text | null;
  flags: number;
  subtreeFlags: number;
  hooks?: Hook[];
  lanes: Lanes;
  childLanes: Lanes;
  parent: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
}

type FiberWithDom = Fiber & { dom: NonNullable<Fiber["dom"]> };

type CallerManagedFiberFields = Pick<
  Fiber,
  | "type"
  | "key"
  | "index"
  | "props"
  | "dom"
  | "parent"
  | "child"
  | "sibling"
  | "flags"
  | "lanes"
  | "childLanes"
>;

const FIBER_FLAG = {
  NONE: 0b0000,
  PLACEMENT: 0b0001,
  UPDATE: 0b0010,
  DELETION: 0b0100,
} as const;

type FiberFlag = ObjectValues<typeof FIBER_FLAG>;

function hasFlag(flags: number, flag: FiberFlag): boolean {
  return (flags & flag) !== 0;
}

const LANE = {
  NONE: 0b0000,
  DISCRETE: 0b0001,
  CONTINUOUS: 0b0010,
  DEFAULT: 0b0100,
  LOW: 0b1000,
} as const;

// Lane: a single bit
// Lanes: any combination of bits
type Lane = ObjectValues<typeof LANE>;
type Lanes = number;

interface Hook {
  state: unknown;
  queue: Array<(prevState: unknown) => unknown>;
}

let isMessageLoopRunning = false;

let nextUnitOfWork: Fiber | null = null;

let wipRootFiber: Fiber | null = null;
let committedRootFiber: Fiber | null = null;

let deletions: Fiber[] = [];

// tracks which fiber is currently being rendered and which useState call
// we're on within it, so useState can find its slot without being passed
// the fiber directly
let renderingFiber: Fiber | null = null;
let hookIndex = 0;

function wakeMessageLoop(): void {
  if (isMessageLoopRunning) return;
  isMessageLoopRunning = true;
  scheduleWorkUntilDeadline(performWorkUntilDeadline);
}

export function render(element: DidactElement, container: HTMLElement): void {
  scheduleNewRootFiber({
    type: ROOT_FIBER_TYPE,
    dom: container,
    props: { children: [element] },
    alternate: committedRootFiber,
  });

  wakeMessageLoop();
}

function scheduleNewRootFiber(
  rootFiberInit: Pick<Fiber, "type" | "dom" | "props" | "alternate">,
): void {
  const overrides: CallerManagedFiberFields = {
    type: rootFiberInit.type,
    dom: rootFiberInit.dom,
    props: rootFiberInit.props,
    key: null,
    index: 0,
    lanes: LANE.NONE,
    childLanes: rootFiberInit.alternate?.childLanes ?? LANE.NONE,
    parent: null,
    child: null,
    sibling: null,
    flags: FIBER_FLAG.NONE,
  };

  if (rootFiberInit.alternate) {
    wipRootFiber = getOrCreateWorkInProgressFiber(
      rootFiberInit.alternate,
      overrides,
    );
  } else {
    wipRootFiber = {
      ...overrides,
      alternate: null,
      subtreeFlags: FIBER_FLAG.NONE,
    };
  }

  nextUnitOfWork = wipRootFiber;
  deletions = [];
}

function performWorkUntilDeadline(): void {
  const sliceStart = performance.now();
  const sliceDeadline = sliceStart + WORK_LOOP_FRAME_BUDGET_MS;
  let shouldYield = false;

  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = performance.now() >= sliceDeadline;
  }

  if (!nextUnitOfWork && wipRootFiber) {
    commitRootFiber();
  }

  // if no other work, loop dies, waiting for explicit wake
  if (nextUnitOfWork) {
    scheduleWorkUntilDeadline(performWorkUntilDeadline);
  } else {
    isMessageLoopRunning = false;
  }
}

function performUnitOfWork(wipFiber: Fiber): Fiber | null {
  const nextFiberBelowToVisit = beginWork(wipFiber);

  if (!nextFiberBelowToVisit) {
    // work is fully done on this subtree, walk back up for the next sibling
    return completeUnitOfWork(wipFiber);
  }

  return nextFiberBelowToVisit;
}

function beginWork(wipFiber: Fiber): Fiber | null {
  const isInitialRender = wipFiber.alternate === null;
  const hasUnchangedProps =
    !isInitialRender && wipFiber.props === wipFiber.alternate!.props;
  const hasPendingWork = wipFiber.lanes !== LANE.NONE;
  const hasPendingWorkBelow = wipFiber.childLanes !== LANE.NONE;
  const hasPendingWorkOnlyBelow = !hasPendingWork && hasPendingWorkBelow;

  if (hasUnchangedProps && !hasPendingWork && !hasPendingWorkBelow) {
    // nothing anywhere in this subtree needs anything — don't even
    // walk into it; child/sibling already point at the correct,
    // currently-valid, already-committed subtree
    return null;
  }

  if (hasUnchangedProps && hasPendingWorkOnlyBelow) {
    cloneChildFibers(wipFiber);
    return wipFiber.child;
  }

  const isFunctionComponent = typeof wipFiber.type === "function";
  if (isFunctionComponent) {
    updateFunctionComponent(wipFiber);
  } else {
    updateHostComponent(wipFiber);
  }

  // whatever pending update caused this fiber to be visited has now
  // been applied — clear it so bubbling (and later, bailout) don't see
  // stale "still pending" bits after the work is actually done
  wipFiber.lanes = LANE.NONE;
  return wipFiber.child;
}

function cloneChildFibers(wipFiber: Fiber): void {
  const oldChildFiber = wipFiber.alternate?.child ?? null;
  let prevSiblingOfClonedChildFiber: Fiber | null = null;
  let oldChildFiberToClone = oldChildFiber;

  while (oldChildFiberToClone) {
    const clonedChildFiber = cloneChildFiber(oldChildFiberToClone, wipFiber);

    if (!prevSiblingOfClonedChildFiber) {
      wipFiber.child = clonedChildFiber;
    } else {
      prevSiblingOfClonedChildFiber.sibling = clonedChildFiber;
    }
    prevSiblingOfClonedChildFiber = clonedChildFiber;

    oldChildFiberToClone = oldChildFiberToClone.sibling;
  }
}

function cloneChildFiber(
  oldChildFiberToClone: Fiber,
  parentFiber: Fiber,
): Fiber {
  const clonedFiber = getOrCreateWorkInProgressFiber(oldChildFiberToClone, {
    type: oldChildFiberToClone.type,
    key: oldChildFiberToClone.key,
    index: oldChildFiberToClone.index,
    props: oldChildFiberToClone.props,
    dom: oldChildFiberToClone.dom,
    parent: parentFiber,
    child: oldChildFiberToClone.child,
    sibling: null,
    flags: FIBER_FLAG.NONE,
    lanes: oldChildFiberToClone.lanes,
    childLanes: oldChildFiberToClone.childLanes,
  });

  clonedFiber.hooks = oldChildFiberToClone.hooks;
  return clonedFiber;
}

// walks back up from a fiber whose subtree is fully processed, marking
// each ancestor complete in turn, until it finds a sibling to hand off
// to as the next unit of work — or runs out of ancestors entirely
function completeUnitOfWork(wipFiber: Fiber): Fiber | null {
  let completedFiber: Fiber | null = wipFiber;

  while (completedFiber) {
    bubbleProperties(completedFiber);

    if (completedFiber.sibling) {
      return completedFiber.sibling;
    }

    completedFiber = completedFiber.parent;
  }

  return null;
}

function bubbleProperties(wipFiber: Fiber): void {
  // true when this fiber's own children were never re-derived this render
  // which happens only during tier 1 "nothing runs" full bailout
  const fiberDidBailout =
    wipFiber.alternate !== null && wipFiber.alternate.child === wipFiber.child;

  // union of flags whose lifetime is tied to the fiber's own code (e.g.
  // "has an effect hook"), not to a single render — only these are
  // trustworthy through a bailout. mirrors real react's StaticMask;
  // didact has no such flags yet, so this is empty for now.
  const STATIC_FLAG_MASK = 0b0000;

  let newChildLanes: Lanes = LANE.NONE;
  let newSubtreeFlags = FIBER_FLAG.NONE;

  let child = wipFiber.child;
  // roll to the right through siblings chain
  while (child) {
    newChildLanes |= child.lanes | child.childLanes;

    if (fiberDidBailout) {
      // a bailed child's flags are stale leftovers, not this render's
      // truth — only the static subset (currently none) survives
      newSubtreeFlags |= child.flags & STATIC_FLAG_MASK;
      newSubtreeFlags |= child.subtreeFlags & STATIC_FLAG_MASK;
    } else {
      newSubtreeFlags |= child.flags;
      newSubtreeFlags |= child.subtreeFlags;
    }

    child = child.sibling;
  }

  wipFiber.childLanes = newChildLanes;
  wipFiber.subtreeFlags = newSubtreeFlags;
}

function markUpdateLaneFromFiberToRoot(fiber: Fiber, lane: Lane): void {
  fiber.lanes |= lane;
  if (fiber.alternate) fiber.alternate.lanes |= lane;

  let ancestor = fiber.parent;
  while (ancestor) {
    ancestor.childLanes |= lane;
    // if (ancestor.alternate) ancestor.alternate.childLanes |= lane; // most likely redundant

    ancestor = ancestor.parent;
  }
}

function updateFunctionComponent(wipFiber: Fiber) {
  if (typeof wipFiber.type !== "function") {
    // shall never happen — performUnitOfWork only dispatches here for function-typed fibers
    throw new Error(
      "updateFunctionComponent called on a fiber whose type is not a function",
    );
  }

  // useState, invoked from inside the component's body below, reads and
  // writes these globals to find its own fiber and hook slot — the
  // component itself has no way to receive the fiber as an argument
  renderingFiber = wipFiber;
  hookIndex = 0;
  wipFiber.hooks = [];

  const childElements = [wipFiber.type(wipFiber.props)];
  renderingFiber = null;

  // build fibers for this fiber's child elements
  reconcileChildren(wipFiber, childElements);
}

function updateHostComponent(wipFiber: Fiber) {
  // create DOM for this fiber if it doesn't have one yet
  if (!wipFiber.dom) {
    wipFiber.dom = createDom(wipFiber);
  }

  // build fibers for this fiber's child elements
  reconcileChildren(wipFiber, wipFiber.props.children);
}

function reconcileChildren(
  wipFiber: Fiber,
  childElements: DidactElement[],
): void {
  // clear existing child
  wipFiber.child = null;

  const oldChildFiber: Fiber | null = wipFiber.alternate?.child ?? null;
  let prevSiblingOfNewChildFiber: Fiber | null = null;

  const oldChildFibersMapByKey = createOldChildFibersMapByKey(oldChildFiber);
  let highestStableOldFiberIndex = 0;

  childElements.forEach((childElement, childElementIndex) => {
    const reconciliationKey = childElement.key ?? childElementIndex;
    const matchedOldChildFiber =
      oldChildFibersMapByKey.get(reconciliationKey) ?? null;
    oldChildFibersMapByKey.delete(reconciliationKey);

    const newChildFiber = reconcileChildFiber(
      matchedOldChildFiber,
      childElement,
      wipFiber,
      childElementIndex,
    );

    // only a genuine reuse participates in the stable/move decision below
    // we mark the fibers that need to move and cannot just stay
    if (
      matchedOldChildFiber &&
      matchedOldChildFiber.type === childElement.type
    ) {
      if (matchedOldChildFiber.index < highestStableOldFiberIndex) {
        newChildFiber.flags |= FIBER_FLAG.PLACEMENT;
      } else {
        highestStableOldFiberIndex = matchedOldChildFiber.index;
      }
    }

    if (childElementIndex === 0) {
      wipFiber.child = newChildFiber;
    } else {
      prevSiblingOfNewChildFiber!.sibling = newChildFiber;
    }
    prevSiblingOfNewChildFiber = newChildFiber;
  });

  // whatever's still in the map was never claimed by any new element —
  // a genuine removal from the list, not a type mismatch
  oldChildFibersMapByKey.forEach((leftoverOldFiber) => {
    leftoverOldFiber.flags = FIBER_FLAG.DELETION;
    deletions.push(leftoverOldFiber);
  });
}

function createOldChildFibersMapByKey(
  leftmostOldChildFiber: Fiber | null,
): Map<string | number, Fiber> {
  const map = new Map<string | number, Fiber>();
  let oldChildFiber = leftmostOldChildFiber;

  while (oldChildFiber) {
    const reconciliationKey = oldChildFiber.key ?? oldChildFiber.index;
    map.set(reconciliationKey, oldChildFiber);
    oldChildFiber = oldChildFiber.sibling;
  }

  return map;
}

function reconcileChildFiber(
  matchedOldChildFiber: Fiber | null,
  childElement: DidactElement,
  parentFiber: Fiber,
  index: number,
): Fiber {
  if (matchedOldChildFiber && matchedOldChildFiber.type !== childElement.type) {
    // matched by key/index, but the type differs — old dom can't be
    // reused, so the old fiber is discarded rather than updated
    matchedOldChildFiber.flags = FIBER_FLAG.DELETION;
    deletions.push(matchedOldChildFiber);
  }

  // inlined on purpose: aliasing this through a shared helper function
  // would lose the narrowing below
  const isSameType =
    matchedOldChildFiber !== null &&
    matchedOldChildFiber.type === childElement.type;

  const sharedFiberFields = {
    key: childElement.key,
    index,
    parent: parentFiber,
  };
  if (isSameType) {
    return getOrCreateWorkInProgressFiber(matchedOldChildFiber, {
      ...sharedFiberFields,
      type: matchedOldChildFiber.type,
      props: childElement.props,
      dom: matchedOldChildFiber.dom,
      child: matchedOldChildFiber.child,
      sibling: null,
      flags: FIBER_FLAG.UPDATE,
      // we inherit lanes from previous because this is where setState marked them
      lanes: matchedOldChildFiber.lanes,
      childLanes: matchedOldChildFiber.childLanes,
    });
  } else {
    return {
      ...sharedFiberFields,
      type: childElement.type,
      props: childElement.props,
      dom: null,
      child: null,
      sibling: null,
      alternate: null,
      flags: FIBER_FLAG.PLACEMENT,
      subtreeFlags: FIBER_FLAG.NONE,
      // fresh fiber, nothing to work on yet
      lanes: LANE.NONE,
      childLanes: LANE.NONE,
    };
  }
}

// double-buffering: reuses this fiber's own pooled counterpart (its
// alternate, from two renders back) if one exists, mutating it in place
// instead of allocating. every render-varying (caller managed) field is required, not
// optional — nothing is left over from whatever the pooled object was
// last used for.
function getOrCreateWorkInProgressFiber(
  oldFiber: Fiber,
  overrides: CallerManagedFiberFields,
): Fiber {
  const pooledFiber = oldFiber.alternate;

  if (pooledFiber) {
    Object.assign(pooledFiber, overrides);
    pooledFiber.alternate = oldFiber;
    return pooledFiber;
  }

  const freshFiber: Fiber = {
    ...overrides,
    alternate: oldFiber,
    subtreeFlags: FIBER_FLAG.NONE,
  };
  oldFiber.alternate = freshFiber;
  return freshFiber;
}

function createDom(fiber: Fiber): HTMLElement | Text {
  if (fiber.type === "TEXT_ELEMENT") {
    return document.createTextNode(String(fiber.props.nodeValue));
  }

  if (typeof fiber.type !== "string") {
    // shall never happen — createDom is only called for host fibers, whose type is always a tag name string
    throw new Error("createDom called on a fiber whose type is not a string");
  }

  const dom = document.createElement(fiber.type);
  updateDom(dom, { children: [] }, fiber.props);
  return dom;
}

function updateDom(
  dom: HTMLElement | Text,
  prevProps: DidactElementProps,
  nextProps: DidactElementProps,
): void {
  const isEventListenerProp = (key: string) => key.startsWith("on");
  const isProperty = (key: string) =>
    key !== "children" && !isEventListenerProp(key);
  const isGone = (key: string) => !(key in nextProps);
  const isChanged = (key: string) => prevProps[key] !== nextProps[key];
  const isRemovedOrChanged = (key: string) => isGone(key) || isChanged(key);
  const toDomEventType = (propKey: string) =>
    propKey.toLowerCase().substring(2);

  // remove event listeners that are gone or whose handler changed
  Object.keys(prevProps)
    .filter(isEventListenerProp)
    .filter(isRemovedOrChanged)
    .forEach((key) => {
      dom.removeEventListener(
        toDomEventType(key),
        prevProps[key] as EventListener,
      );
    });

  // remove properties that no longer exist on the new props
  Object.keys(prevProps)
    .filter(isProperty)
    .filter(isGone)
    .forEach((key) => {
      // @ts-expect-error — dynamic prop assignment, to revisit later
      dom[key] = "";
    });

  // set properties that are new or changed
  Object.keys(nextProps)
    .filter(isProperty)
    .filter(isChanged)
    .forEach((key) => {
      // @ts-expect-error — dynamic prop assignment, to revisit later
      dom[key] = nextProps[key];
    });

  // add event listeners that are new or whose handler changed
  Object.keys(nextProps)
    .filter(isEventListenerProp)
    .filter(isChanged)
    .forEach((key) => {
      dom.addEventListener(
        toDomEventType(key),
        nextProps[key] as EventListener,
      );
    });
}

function commitRootFiber(): void {
  if (!wipRootFiber) return;

  deletions.forEach(commitFiberDeletion);
  deletions = [];

  commitFiber(wipRootFiber.child);
  committedRootFiber = wipRootFiber;
  wipRootFiber = null;
}

function commitFiber(fiber: Fiber | null): void {
  if (!fiber) {
    return;
  }

  if (hasFlag(fiber.flags, FIBER_FLAG.PLACEMENT)) {
    commitPlacementFiber(fiber);
    // consumed — clear it so later, unrelated commits (which may read this
    // fiber's flags again, e.g. findAttachedDomDescending searching for an
    // anchor) don't mistake a long-settled placement for a pending one

    // bailed-out fiber's reconcileChildFiber never runs for it at all this render
    // and reconcileChildFiber is the only place that assigns a fresh .flags value
    fiber.flags &= ~FIBER_FLAG.PLACEMENT;
  }
  if (hasFlag(fiber.flags, FIBER_FLAG.UPDATE)) {
    commitUpdateFiber(fiber);
    fiber.flags &= ~FIBER_FLAG.UPDATE;
  }

  // recursive calls
  // nothing changed anywhere below — don't even walk in
  if (fiber.subtreeFlags !== FIBER_FLAG.NONE) {
    commitFiber(fiber.child);
  }
  commitFiber(fiber.sibling);
}

function commitPlacementFiber(fiber: Fiber) {
  if (!fiber.dom) {
    // function component's fiber — no dom of its own to move, but its
    // placement still needs to happen, so forward it to whatever the
    // component actually rendered
    if (fiber.child) commitPlacementFiber(fiber.child);
    return;
  }

  const ancestorFiberWithDom = findAncestorFiberWithDom(fiber.parent);
  const insertionReferenceDom = findAttachedDomAfterFiber(
    fiber,
    ancestorFiberWithDom,
  );

  if (insertionReferenceDom) {
    ancestorFiberWithDom.dom.insertBefore(fiber.dom, insertionReferenceDom);
  } else {
    // no attached sibling to insert before — this fiber belongs at the end
    ancestorFiberWithDom.dom.appendChild(fiber.dom);
  }
}

function commitUpdateFiber(fiber: Fiber) {
  if (!fiber.dom) return; // function component's fiber

  if (!fiber.alternate) {
    // shall never happen — reconcileChildFiber only tags UPDATE together with
    // setting alternate to the matched old fiber
    throw new Error(
      "commitFiber found an UPDATE-tagged fiber with no alternate",
    );
  }

  updateDom(fiber.dom, fiber.alternate.props, fiber.props);
}

// starting with fiber's sinblings goes up until (not including) ancestorFiberWithDom,
// checking siblings, descending into a dom-less sibling's own children as needed,
// to find attached dom to the right
function findAttachedDomAfterFiber(
  fiber: Fiber,
  ancestorFiberWithDom: FiberWithDom,
): HTMLElement | Text | null {
  const attachedSiblingDom = findAttachedDomAmongSiblingChain(fiber.sibling);
  if (attachedSiblingDom) {
    return attachedSiblingDom;
  }

  if (fiber.parent === ancestorFiberWithDom) {
    return null;
  }

  if (!fiber.parent) {
    // shall never happen — ancestorFiberWithDom was found by walking up
    // from this same fiber via findAncestorFiberWithDom, so this chain
    // must reach it before running out of parents
    throw new Error(
      "findAttachedDomAfterFiber ran out of ancestors before reaching the dom-bearing ancestor",
    );
  }

  return findAttachedDomAfterFiber(fiber.parent, ancestorFiberWithDom);
}

// walks forward through a single level's sibling chain, looking for the
// first one with an attached dom. never looks left — by the time a fiber
// is committed, everything to its left at this level has already been
// committed and correctly positioned.
function findAttachedDomAmongSiblingChain(
  siblingFiber: Fiber | null,
): HTMLElement | Text | null {
  if (!siblingFiber) {
    return null;
  }

  const attachedDom = findAttachedDomDescending(siblingFiber);
  if (attachedDom) {
    return attachedDom;
  }

  return findAttachedDomAmongSiblingChain(siblingFiber.sibling);
}

function findAttachedDomDescending(fiber: Fiber): HTMLElement | Text | null {
  // a fiber tagged PLACEMENT is about to move — its current dom position
  // (even if currently connected) can't be trusted as an anchor
  if (hasFlag(fiber.flags, FIBER_FLAG.PLACEMENT)) {
    return null;
  }

  // dom-less (function component) — its content is one level down
  if (typeof fiber.type === "function") {
    return fiber.child ? findAttachedDomDescending(fiber.child) : null;
  }

  // isConnected is live DOM state —
  // true only once this node has actually been inserted into the page
  return fiber.dom && fiber.dom.isConnected ? fiber.dom : null;
}

function commitFiberDeletion(fiber: Fiber): void {
  const ancestorFiberWithDom = findAncestorFiberWithDom(fiber.parent);

  if (fiber.dom) {
    ancestorFiberWithDom.dom.removeChild(fiber.dom);
    return;
  }

  // no dom on this fiber — the removable
  // dom must be nested inside a child fiber instead
  // and we look only to child (not its siblings)
  // because Function components always return single element
  if (fiber.child) {
    commitFiberDeletion(fiber.child);
  }
}

function findAncestorFiberWithDom(fiber: Fiber | null): FiberWithDom {
  if (!fiber) {
    // shall never happen — every committed tree bottoms out at wipRootFiber, which always has a dom
    throw new Error(
      "no ancestor fiber with a dom was found while walking up from this fiber",
    );
  }

  if (fiber.dom) {
    return fiber as FiberWithDom;
  }

  return findAncestorFiberWithDom(fiber.parent);
}

export function useState<StateType>(
  initialState: StateType,
): [StateType, (action: (prevState: StateType) => StateType) => void] {
  if (!renderingFiber) {
    // shall never happen — useState can only run while a function component
    // is being invoked, which only happens while renderingFiber is set
    throw new Error("useState called outside of a function component render");
  }

  if (!renderingFiber.hooks) {
    // shall never happen — updateFunctionComponent always sets hooks to an
    // empty array before calling the component function
    throw new Error("useState called on a fiber with no hooks array");
  }

  const ownerFiber = renderingFiber;
  const oldHook = renderingFiber.alternate?.hooks?.[hookIndex];

  const hook: Hook = {
    state: oldHook ? oldHook.state : initialState,
    queue: [],
  };

  const pendingActions = oldHook ? oldHook.queue : [];
  pendingActions.forEach((action) => {
    hook.state = action(hook.state);
  });

  const setState = (action: (prevState: StateType) => StateType) => {
    hook.queue.push(action as (prevState: unknown) => unknown);
    markUpdateLaneFromFiberToRoot(ownerFiber, LANE.DEFAULT); // placeholder — real classification lands separately

    if (!committedRootFiber) {
      // shall never happen — setState only exists after a first render has
      // completed, which always sets committedRootFiber
      throw new Error("setState called before any fiber tree was committed");
    }

    scheduleNewRootFiber({
      type: committedRootFiber.type,
      dom: committedRootFiber.dom,
      props: committedRootFiber.props,
      alternate: committedRootFiber,
    });

    wakeMessageLoop();
  };

  renderingFiber.hooks.push(hook);
  hookIndex++;

  return [hook.state as StateType, setState];
}

// babel compiles jsx into calls to this function, per the pragma
// configured in tsconfig.json and html.html's transpile step.
// produces the element tree that render()/performUnitOfWork() consume.

export function createElement(
  type: DidactElement["type"],
  props: Record<string, unknown> | null,
  ...children: DidactNode[]
): DidactElement {
  const { key: rawKey = null, ...restProps } = props ?? {};
  const key = toElementKey(rawKey);
  return {
    type,
    key,
    props: {
      ...restProps,
      // we need to flatten the array for the case it was something like
      // <div>
      //   {groups.map((group) => group.items.map((item) => <span>{item}</span>))}
      // </div>
      children: children
        .flat(Infinity)
        .map((child) =>
          typeof child === "object" ? child : createTextElement(child),
        ),
    },
  };
}

function toElementKey(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
}

export function createTextElement(child: string | number): DidactElement {
  return {
    type: "TEXT_ELEMENT",
    key: null,
    props: { nodeValue: child, children: [] },
  };
}
