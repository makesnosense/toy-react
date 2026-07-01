interface DidactElement {
  type: string;
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
}

let nextUnitOfWork: Fiber | null = null;
let wipRootFiber: Fiber | null = null;

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

function setDomProperties(dom: HTMLElement, props: DidactElementProps): void {
  const isProp = (key: string) => key !== "children";

  Object.keys(props)
    .filter(isProp)
    .forEach((name) => {
      // @ts-expect-error — dynamic prop assignment, to revisit later
      dom[name] = props[name];
    });
}

function createDom(fiber: Fiber): HTMLElement | Text {
  if (fiber.type === "TEXT_ELEMENT") {
    return document.createTextNode(String(fiber.props.nodeValue));
  }
  const dom = document.createElement(fiber.type);
  setDomProperties(dom, fiber.props);
  return dom;
}

function performUnitOfWork(fiber: Fiber): Fiber | null {
  // 1. create DOM for this fiber if it doesn't have one yet
  if (!fiber.dom) {
    fiber.dom = createDom(fiber);
  }

  // 2. build fibers for this fiber's children
  const childElements = fiber.props.children;

  let childElementIndex = 0;
  let prevSibling: Fiber | null = null;

  while (childElementIndex < childElements.length) {
    const childElement = childElements[childElementIndex];

    const newFiber: Fiber = {
      type: childElement.type,
      props: childElement.props,
      dom: null,
      parent: fiber,
      child: null,
      sibling: null,
    };

    //  only the very first child is reachable directly from the parent
    if (childElementIndex === 0) {
      fiber.child = newFiber;
    } else if (prevSibling) {
      prevSibling.sibling = newFiber;
    }

    prevSibling = newFiber;
    childElementIndex++;
  }

  // 3.  return whichever fiber should be visited next

  if (fiber.child) {
    return fiber.child;
  }

  if (fiber.sibling) {
    return fiber.sibling;
  }

  // if no sibling, we backtrack to ancestor with sibling
  // and return that sibling
  let ancestor: Fiber | null = fiber.parent;
  while (ancestor) {
    if (ancestor.sibling) {
      return ancestor.sibling;
    }
    ancestor = ancestor.parent;
  }

  return null;
}

function commitRootFiber(): void {
  if (!wipRootFiber) return;
  commitFiber(wipRootFiber.child);
  wipRootFiber = null;
}

function commitFiber(fiber: Fiber | null): void {
  if (!fiber) {
    return;
  }

  if (!fiber.parent || !fiber.parent.dom) {
    // shall never happen cause only fiber with no parent is rootFiber
    throw new Error(
      "commitFiber called on a fiber with no parent dom (the root fiber?)",
    );
  }

  const parentFiberDom = fiber.parent.dom;

  if (fiber.dom) {
    // every fiber currently has a dom, since only host components exist so
    // far — createDom() runs unconditionally for them. this check becomes
    // load-bearing once function components (no dom by design) exist.
    parentFiberDom.appendChild(fiber.dom);
  }

  commitFiber(fiber.child);
  commitFiber(fiber.sibling);
}

// babel compiles jsx into calls to this function, per the pragma
// configured in tsconfig.json and html.html's transpile step.
// produces the element tree that render()/performUnitOfWork() consume.

export const createElement = (
  type: string,
  props: Record<string, unknown> | null,
  ...children: DidactNode[]
): DidactElement => ({
  type,
  props: {
    ...props,
    children: children.map((child) =>
      typeof child === "object" ? child : createTextElement(child),
    ),
  },
});

export const createTextElement = (child: string | number) => ({
  type: "TEXT_ELEMENT",
  props: { nodeValue: child, children: [] },
});
