export type ObjectValues<T> = T[keyof T];

type DidactFunctionComponent = (props: DidactElementProps) => DidactElement;

interface DidactElement {
  type: string | DidactFunctionComponent;
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
  props: DidactElementProps;
  dom: HTMLElement | Text | null;
  parent: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  effectTag: EffectTag | null;
}

type FiberWithDom = Fiber & { dom: NonNullable<Fiber["dom"]> };

const EFFECT_TAG = {
  UPDATE: "UPDATE",
  PLACEMENT: "PLACEMENT",
  DELETION: "DELETION",
} as const;

type EffectTag = ObjectValues<typeof EFFECT_TAG>;

let nextUnitOfWork: Fiber | null = null;

let wipRootFiber: Fiber | null = null;
let currentRootFiber: Fiber | null = null;

let deletions: Fiber[] = [];

let workLoopStarted = false;

export function render(element: DidactElement, container: HTMLElement): void {
  wipRootFiber = {
    type: ROOT_FIBER_TYPE,
    dom: container,
    props: {
      children: [element],
    },
    parent: null,
    child: null,
    sibling: null,
    alternate: currentRootFiber,
    effectTag: null,
  };

  nextUnitOfWork = wipRootFiber;

  if (!workLoopStarted) {
    workLoopStarted = true;
    requestIdleCallback(workLoop);
  }
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

  const childElements = [wipFiber.type(wipFiber.props)];

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
  let childElementIndex = 0;
  let oldChildFiber: Fiber | null = wipFiber.alternate?.child ?? null;
  let prevSiblingOfNewChildFiber: Fiber | null = null;

  // || keeps going until both arrays are exhausted
  while (childElementIndex < childElements.length || oldChildFiber !== null) {
    const childElement = childElements[childElementIndex] ?? null;

    const newChildFiber = createChildFiber(
      oldChildFiber,
      childElement,
      wipFiber,
    );

    const isSameType =
      oldChildFiber !== null &&
      childElement !== null &&
      oldChildFiber.type === childElement.type;

    if (!isSameType && oldChildFiber) {
      // oldChildFiber exists, but in new element tree it is not present
      // so no match for this old child fiber, tag DELETION, push to deletions
      oldChildFiber.effectTag = EFFECT_TAG.DELETION;
      deletions.push(oldChildFiber);
    }

    // linking new child fibers

    // setting child
    if (childElementIndex === 0) {
      wipFiber.child = newChildFiber;
      // setting sibling on the child on the left
    } else if (childElement) {
      prevSiblingOfNewChildFiber!.sibling = newChildFiber;
    }
    prevSiblingOfNewChildFiber = newChildFiber;

    // moving the while
    if (oldChildFiber) {
      // move to next sibling
      oldChildFiber = oldChildFiber.sibling;
    }
    childElementIndex++;
  }
}

function createChildFiber(
  oldChildFiber: Fiber | null,
  childElement: DidactElement | null,
  parentFiber: Fiber,
): Fiber | null {
  // inlined on purpose: aliasing this through a shared helper function
  // would lose the narrowing below
  const isSameType =
    oldChildFiber !== null &&
    childElement !== null &&
    oldChildFiber.type === childElement.type;

  const sharedFiberFields = {
    parent: parentFiber,
    child: null,
    sibling: null,
  };

  if (isSameType) {
    return {
      ...sharedFiberFields,
      type: oldChildFiber.type,
      props: childElement.props,
      dom: oldChildFiber.dom,
      alternate: oldChildFiber,
      effectTag: EFFECT_TAG.UPDATE,
    };
  }

  if (childElement) {
    return {
      ...sharedFiberFields,
      type: childElement.type,
      props: childElement.props,
      dom: null,
      alternate: null,
      effectTag: EFFECT_TAG.PLACEMENT,
    };
  }

  return null;
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

  const ancestorFiberWithDom = findAncestorFiberWithDom(fiber.parent);

  // known limitation: appendChild always inserts at the end of the parent's
  // current children, with no regard for this fiber's position among its
  // siblings in the fiber tree. when a type-mismatch swap happens at a
  // non-last index and a later sibling survives as UPDATE (never moved),
  // the newly placed node lands after it instead of at its correct index.

  if (fiber.effectTag === EFFECT_TAG.PLACEMENT && fiber.dom) {
    // function-component fibers never get a dom (see updateFunctionComponent)
    ancestorFiberWithDom.dom.appendChild(fiber.dom);
  } else if (fiber.effectTag === EFFECT_TAG.UPDATE && fiber.dom) {
    if (!fiber.alternate) {
      // shall never happen — createChildFiber only tags UPDATE together with
      // setting alternate to the matched old fiber
      throw new Error(
        "commitFiber found an UPDATE-tagged fiber with no alternate",
      );
    }

    updateDom(fiber.dom, fiber.alternate.props, fiber.props);
  }

  commitFiber(fiber.child);
  commitFiber(fiber.sibling);
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

// babel compiles jsx into calls to this function, per the pragma
// configured in tsconfig.json and html.html's transpile step.
// produces the element tree that render()/performUnitOfWork() consume.

export function createElement(
  type: DidactElement["type"],
  props: Record<string, unknown> | null,
  ...children: DidactNode[]
): DidactElement {
  return {
    type,
    props: {
      ...props,
      children: children.map((child) =>
        typeof child === "object" ? child : createTextElement(child),
      ),
    },
  };
}

export function createTextElement(child: string | number): DidactElement {
  return {
    type: "TEXT_ELEMENT",
    props: { nodeValue: child, children: [] },
  };
}
