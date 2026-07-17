export type ObjectValues<T> = T[keyof T];

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
  parent: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  flags: number;
  hooks?: Hook[];
}

type FiberWithDom = Fiber & { dom: NonNullable<Fiber["dom"]> };

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

interface Hook {
  state: unknown;
  queue: Array<(prevState: unknown) => unknown>;
}

let workLoopStarted = false;

let nextUnitOfWork: Fiber | null = null;

let wipRootFiber: Fiber | null = null;
let currentRootFiber: Fiber | null = null;

let deletions: Fiber[] = [];

// tracks which fiber is currently being rendered and which useState call
// we're on within it, so useState can find its slot without being passed
// the fiber directly
let renderingFiber: Fiber | null = null;
let hookIndex = 0;

export function render(element: DidactElement, container: HTMLElement): void {
  scheduleNewRootFiber({
    type: ROOT_FIBER_TYPE,
    dom: container,
    props: { children: [element] },
    alternate: currentRootFiber,
  });

  if (!workLoopStarted) {
    workLoopStarted = true;
    requestIdleCallback(workLoop);
  }
}

function scheduleNewRootFiber(
  rootFiberInit: Pick<Fiber, "type" | "dom" | "props" | "alternate">,
): void {
  wipRootFiber = {
    ...rootFiberInit,
    key: null,
    index: 0,
    parent: null,
    child: null,
    sibling: null,
    flags: FIBER_FLAG.NONE,
  };
  nextUnitOfWork = wipRootFiber;
  deletions = [];
}

function workLoop(deadline: IdleDeadline): void {
  let shouldYield = false;

  while (nextUnitOfWork && !shouldYield) {
    nextUnitOfWork = performUnitOfWork(nextUnitOfWork);
    shouldYield = deadline.timeRemaining() < 1;
  }

  if (!nextUnitOfWork && wipRootFiber) {
    commitRootFiber();
  }

  requestIdleCallback(workLoop);
}

function performUnitOfWork(wipFiber: Fiber): Fiber | null {
  const isFunctionComponent = typeof wipFiber.type === "function";

  if (isFunctionComponent) {
    updateFunctionComponent(wipFiber);
  } else {
    updateHostComponent(wipFiber);
  }

  // return whichever fiber should be visited next

  if (wipFiber.child) {
    return wipFiber.child;
  }

  if (wipFiber.sibling) {
    return wipFiber.sibling;
  }

  // if no sibling, we backtrack to ancestor with sibling
  // and return that sibling
  let ancestor: Fiber | null = wipFiber.parent;
  while (ancestor) {
    if (ancestor.sibling) {
      return ancestor.sibling;
    }
    ancestor = ancestor.parent;
  }

  return null;
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
  const oldChildFiber: Fiber | null = wipFiber.alternate?.child ?? null;
  let prevSiblingOfNewChildFiber: Fiber | null = null;

  const oldFiberMapByKey = createOldFibersMapByKey(oldChildFiber);
  let highestStableOldFiberIndex = 0;

  childElements.forEach((childElement, childElementIndex) => {
    const reconciliationKey = childElement.key ?? childElementIndex;
    const matchedOldFiber = oldFiberMapByKey.get(reconciliationKey) ?? null;
    oldFiberMapByKey.delete(reconciliationKey);

    const newChildFiber = createChildFiber(
      matchedOldFiber,
      childElement,
      wipFiber,
      childElementIndex,
    );

    if (matchedOldFiber && matchedOldFiber.type !== childElement.type) {
      // matched by key/index, but the type differs — old dom can't be
      // reused, so the old fiber is discarded rather than updated
      matchedOldFiber.flags = FIBER_FLAG.DELETION;
      deletions.push(matchedOldFiber);
    }

    // only a genuine reuse participates in the stable/move decision below
    // we mark the fibers that need to move and cannot just stay
    if (matchedOldFiber && matchedOldFiber.type === childElement.type) {
      if (matchedOldFiber.index < highestStableOldFiberIndex) {
        newChildFiber.flags |= FIBER_FLAG.PLACEMENT;
      } else {
        highestStableOldFiberIndex = matchedOldFiber.index;
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
  oldFiberMapByKey.forEach((leftoverOldFiber) => {
    leftoverOldFiber.flags = FIBER_FLAG.DELETION;
    deletions.push(leftoverOldFiber);
  });
}

function createOldFibersMapByKey(
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

function createChildFiber(
  matchedOldFiber: Fiber | null,
  childElement: DidactElement,
  parentFiber: Fiber,
  index: number,
): Fiber {
  // inlined on purpose: aliasing this through a shared helper function
  // would lose the narrowing below
  const isSameType =
    matchedOldFiber !== null && matchedOldFiber.type === childElement.type;

  const sharedFiberFields = {
    key: childElement.key,
    index,
    parent: parentFiber,
    child: null,
    sibling: null,
  };

  if (isSameType) {
    return {
      ...sharedFiberFields,
      type: matchedOldFiber.type,
      props: childElement.props,
      dom: matchedOldFiber.dom,
      alternate: matchedOldFiber,
      flags: FIBER_FLAG.UPDATE,
    };
  } else {
    return {
      ...sharedFiberFields,
      type: childElement.type,
      props: childElement.props,
      dom: null,
      alternate: null,
      flags: FIBER_FLAG.PLACEMENT,
    };
  }
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
  currentRootFiber = wipRootFiber;
  wipRootFiber = null;
}

function commitFiber(fiber: Fiber | null): void {
  if (!fiber) {
    return;
  }

  if (hasFlag(fiber.flags, FIBER_FLAG.PLACEMENT)) {
    commitPlacementFiber(fiber);
  }
  if (hasFlag(fiber.flags, FIBER_FLAG.UPDATE)) {
    commitUpdateFiber(fiber);
  }

  // recursive calls
  commitFiber(fiber.child);
  commitFiber(fiber.sibling);
}

function commitPlacementFiber(fiber: Fiber) {
  if (!fiber.dom) return; // function component's fiber

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
    // shall never happen — createChildFiber only tags UPDATE together with
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

    if (!currentRootFiber) {
      // shall never happen — setState only exists after a first render has
      // completed, which always sets currentRootFiber
      throw new Error("setState called before any fiber tree was committed");
    }

    scheduleNewRootFiber({
      type: currentRootFiber.type,
      dom: currentRootFiber.dom,
      props: currentRootFiber.props,
      alternate: currentRootFiber,
    });
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
