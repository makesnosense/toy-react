import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, getByText } from "@testing-library/dom";
import * as ToyReact from "./toy-react";

// one macrotask tick
const waitForRender = () =>
  new Promise<void>((resolve) => {
    const nodeSetImmediate = (
      globalThis as unknown as { setImmediate: (callback: () => void) => void }
    ).setImmediate;
    nodeSetImmediate(resolve);
  });

// a fresh dom node, attached to document.body so Node.isConnected reports
// true — attached and detached around every test via beforeEach/afterEach,
// so no test's dom can leak into another
function createMountedRoot() {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    root.remove();
  });

  return {
    get current() {
      return root;
    },
  };
}

describe("work loop scheduling", () => {
  const containerA = createMountedRoot();
  const containerB = createMountedRoot();

  it("starts the work loop only once, even across multiple renders", async () => {
    const nodeGlobal = globalThis as unknown as {
      setImmediate: (callback: () => void) => void;
    };

    // spying before the (fresh) module loads matters
    const setImmediateSpy = vi.spyOn(nodeGlobal, "setImmediate");

    vi.resetModules();
    const ToyReact = await import("./toy-react");

    ToyReact.render(<div />, containerA.current);
    ToyReact.render(<div />, containerB.current);

    expect(setImmediateSpy).toHaveBeenCalledTimes(1);

    // let the one real pending performWorkUntilDeadline actually run and
    // settle, instead of leaving it dangling on the event loop past this
    // test's end
    await waitForRender();

    setImmediateSpy.mockRestore();
  });

  it("yields control back to the event loop mid-render", async () => {
    const log: string[] = [];
    const expensiveItemDurationMs = 8; // comfortably over the 5ms time-slice budget
    const itemCount = 2;

    function ExpensiveItem({ index }: { index: number }) {
      const start = performance.now();
      while (performance.now() - start < expensiveItemDurationMs) {
        // busy-wait, guarantees this single unit alone blows the budget
      }
      log.push(`chunk-${index}`);
      return <div>item {index}</div>;
    }

    const expensiveItems = [];
    for (let index = 0; index < itemCount; index++) {
      expensiveItems.push(<ExpensiveItem key={index} index={index} />);
    }

    // what happens here
    // render() queues the scheduler's performWorkUntilDeadline via setImmediate — call it #1.
    // Test queues competing-task via setImmediate — #2.
    // waitForRender() queues its own resolve via setImmediate — #3.

    ToyReact.render(<div>{expensiveItems}</div>, containerA.current);

    const nodeSetImmediate = (
      globalThis as unknown as { setImmediate: (callback: () => void) => void }
    ).setImmediate;
    nodeSetImmediate(() => log.push("competing-task"));

    await waitForRender();
    expect(log).toEqual(["chunk-0", "competing-task"]);

    await waitForRender();
    expect(log).toEqual(["chunk-0", "competing-task", "chunk-1"]);
  });
});

describe("setState during an in-progress render", () => {
  const root = createMountedRoot();

  it("does not restart in-progress work, and the deferred update still lands", async () => {
    const log: string[] = [];
    const expensiveItemDurationMs = 8; // comfortably over the 5ms time-slice budget

    function ExpensiveItem({ index }: { index: number }) {
      const start = performance.now();
      while (performance.now() - start < expensiveItemDurationMs) {
        // busy-wait, guarantees this single unit alone blows the budget
      }
      log.push(`chunk-${index}`);
      return <div>item {index}</div>;
    }

    let triggerCounterUpdate: (() => void) | null = null;

    function Counter() {
      const [count, setCount] = ToyReact.useState(0);
      triggerCounterUpdate = () => setCount((previous) => previous + 1);
      return <span id="count">{count}</span>;
    }

    function AppFast() {
      return (
        <div>
          <Counter />
        </div>
      );
    }

    function AppSlow() {
      return (
        <div>
          <Counter />
          <ExpensiveItem key="0" index={0} />
          <ExpensiveItem key="1" index={1} />
        </div>
      );
    }

    // mount commits fully before anything slow exists — committedRootFiber
    // is guaranteed non-null from here on
    ToyReact.render(<AppFast />, root.current);
    await waitForRender();

    ToyReact.render(<AppSlow />, root.current);
    await waitForRender();
    expect(log).toEqual(["chunk-0"]);

    triggerCounterUpdate!();

    await waitForRender();
    expect(log).toEqual(["chunk-0", "chunk-1"]);

    // this tick finishes remaining work and schedules counter change
    await waitForRender();
    // changes counter
    await waitForRender();
    expect(root.current.querySelector("#count")?.textContent).toBe("1");
  });
});

describe("discrete events interrupt an in-progress render", () => {
  const root = createMountedRoot();

  it("discards in-progress work and restarts when a discrete update arrives", async () => {
    const log: string[] = [];
    const expensiveItemDurationMs = 8; // comfortably over the 5ms time-slice budget

    function ExpensiveItem({ index }: { index: number }) {
      const start = performance.now();
      while (performance.now() - start < expensiveItemDurationMs) {
        // busy-wait, guarantees this single unit alone blows the budget
      }
      log.push(`chunk-${index}`);
      return <div>item {index}</div>;
    }

    function ClickMarker() {
      log.push("click");
      return null;
    }

    let showSlowSection: (() => void) | null = null;

    function App() {
      const [slow, setSlow] = ToyReact.useState(false);
      const [clicked, setClicked] = ToyReact.useState(false);
      showSlowSection = () => setSlow(() => true);

      return (
        <div>
          <button id="trigger" onClick={() => setClicked(() => true)}>
            click
          </button>
          {clicked && <ClickMarker />}
          {slow && <ExpensiveItem key="0" index={0} />}
          {slow && <ExpensiveItem key="1" index={1} />}
        </div>
      );
    }
    // mount commits fully before anything slow exists — committedRootFiber
    // is guaranteed non-null from here on
    ToyReact.render(<App />, root.current);
    await waitForRender();

    showSlowSection!(); // DEFAULT priority — a direct call, not a native event

    // The await waitForRender() in between is what forces the slow pass to actually run —
    // execute ExpensiveItem's busy-wait, log "chunk-0",
    // hit the 5ms budget, and yield with nextUnitOfWork genuinely mid-chain
    await waitForRender();
    expect(log).toEqual(["chunk-0"]);

    // DISCRETE priority — a real click, dispatched synchronously, while the
    // slow-section render is still yielded mid-pass
    fireEvent.click(root.current.querySelector("#trigger")!);

    await waitForRender();
    // restart signature: chunk-0 runs again — and "click" appears before it,
    // proving the click's state landed inside the very pass that restarted,
    // not a pass after
    expect(log).toEqual(["chunk-0", "click", "chunk-0"]);

    await waitForRender();
    expect(log).toEqual(["chunk-0", "click", "chunk-0", "chunk-1"]);
  });
});

describe("two sequential different priority updates before either flushes", () => {
  const root = createMountedRoot();

  let triggerLowPriorityUpdate: (() => void) | null = null;

  function LowPriorityComponent() {
    const [value, setValue] = ToyReact.useState("low-initial");
    triggerLowPriorityUpdate = () => setValue(() => "low-updated");
    return <span id="low">{value}</span>;
  }

  function HighPriorityComponent() {
    const [value, setValue] = ToyReact.useState("high-initial");
    return (
      <button id="high-trigger" onClick={() => setValue(() => "high-updated")}>
        <span id="high">{value}</span>
      </button>
    );
  }

  function App() {
    return (
      <div>
        <LowPriorityComponent />
        <HighPriorityComponent />
      </div>
    );
  }

  it("applies a default-lane update and a discrete-lane update scheduled back-to-back, before either flushes", async () => {
    ToyReact.render(<App />, root.current);
    await waitForRender();

    // default-lane update — fired outside any discrete event
    triggerLowPriorityUpdate!();

    // discrete-lane update — fired synchronously right after, in the
    // same tick, before the message loop has run any work for the first
    root.current.querySelector<HTMLButtonElement>("#high-trigger")!.click();

    await waitForRender();

    expect(root.current.querySelector("#low")?.textContent).toBe("low-updated");
    expect(root.current.querySelector("#high")?.textContent).toBe(
      "high-updated",
    );
  });
});

describe("render", () => {
  const root = createMountedRoot();

  function App() {
    return (
      <div>
        <h1>hello</h1>
      </div>
    );
  }

  it("renders nested host elements to the dom", async () => {
    ToyReact.render(<App />, root.current);
    await waitForRender();

    expect(root.current.querySelector("h1")?.textContent).toBe("hello");
  });
});

describe("components and expressions that render nothing", () => {
  const root = createMountedRoot();

  function Empty() {
    return null;
  }

  it("mounts a component that returns null without crashing, and it renders nothing", async () => {
    function App() {
      return (
        <div>
          <span>before</span>
          <Empty />
          <span>after</span>
        </div>
      );
    }

    ToyReact.render(<App />, root.current);
    await waitForRender();

    const outerDiv = root.current.querySelector("div")!;
    expect(
      Array.from(outerDiv.childNodes).map((node) => node.textContent),
    ).toEqual(["before", "after"]);
  });

  it("renders nothing for a boolean child, in both directions, with no stray text node", async () => {
    let toggleShown: (() => void) | null = null;

    function App() {
      const [shown, setShown] = ToyReact.useState(false);
      toggleShown = () => setShown((previous) => !previous);

      return (
        <div>
          <span>before</span>
          {shown && <span id="conditional">shown</span>}
          <span>after</span>
        </div>
      );
    }

    ToyReact.render(<App />, root.current);
    await waitForRender();

    const outerDiv = root.current.querySelector("div")!;
    // mount, condition false — no stray "false" text node between the spans
    expect(
      Array.from(outerDiv.childNodes).map((node) => node.textContent),
    ).toEqual(["before", "after"]);
    expect(outerDiv.querySelector("#conditional")).toBeNull();

    toggleShown!();
    await waitForRender();

    // update, condition true — the conditional element actually mounts
    expect(
      Array.from(outerDiv.childNodes).map((node) => node.textContent),
    ).toEqual(["before", "shown", "after"]);

    toggleShown!();
    await waitForRender();

    // update, condition false again — it's actually removed, not just hidden
    expect(
      Array.from(outerDiv.childNodes).map((node) => node.textContent),
    ).toEqual(["before", "after"]);
  });
});

describe("dom insertion order", () => {
  const root = createMountedRoot();

  function ToggleSection({ showAsDiv }: { showAsDiv: boolean }) {
    return showAsDiv ? <div>section</div> : <span>section</span>;
  }

  function App() {
    const [showAsDiv, setShowAsDiv] = ToyReact.useState(true);
    return (
      <div>
        <button onClick={() => setShowAsDiv((previous) => !previous)}>
          toggle
        </button>
        <ToggleSection showAsDiv={showAsDiv} />
        <h2>unchanged</h2>
      </div>
    );
  }

  it("keeps siblings in order when a nested component's child changes type", async () => {
    ToyReact.render(<App />, root.current);
    await waitForRender();

    const outerDiv = root.current.querySelector("div")!;
    expect(Array.from(outerDiv.children).map((child) => child.tagName)).toEqual(
      ["BUTTON", "DIV", "H2"],
    );

    root.current.querySelector("button")!.click();
    await waitForRender();

    expect(Array.from(outerDiv.children).map((child) => child.tagName)).toEqual(
      ["BUTTON", "SPAN", "H2"],
    );
  });
});

describe("multiple hooks in one component", () => {
  const root = createMountedRoot();

  function Counters() {
    const [count, setCount] = ToyReact.useState(0);
    const [label, setLabel] = ToyReact.useState("a");

    return (
      <div>
        <button
          id="incrementCount"
          onClick={() => setCount((previous) => previous + 1)}
        >
          count
        </button>
        <button
          id="cycleLabel"
          onClick={() => setLabel((previous) => (previous === "a" ? "b" : "a"))}
        >
          label
        </button>
        <span id="countValue">{count}</span>
        <span id="labelValue">{label}</span>
      </div>
    );
  }

  it("keeps each useState call's state independent across updates", async () => {
    ToyReact.render(<Counters />, root.current);
    await waitForRender();

    expect(root.current.querySelector("#countValue")?.textContent).toBe("0");
    expect(root.current.querySelector("#labelValue")?.textContent).toBe("a");

    root.current.querySelector<HTMLButtonElement>("#incrementCount")!.click();
    await waitForRender();

    // only count should change here — if hook index tracking were broken,
    // this update could land on label's slot instead
    expect(root.current.querySelector("#countValue")?.textContent).toBe("1");
    expect(root.current.querySelector("#labelValue")?.textContent).toBe("a");

    root.current.querySelector<HTMLButtonElement>("#cycleLabel")!.click();
    await waitForRender();

    expect(root.current.querySelector("#countValue")?.textContent).toBe("1");
    expect(root.current.querySelector("#labelValue")?.textContent).toBe("b");
  });
});

describe("multiple components using hooks", () => {
  const root = createMountedRoot();

  function Counter({ id }: { id: string }) {
    const [count, setCount] = ToyReact.useState(0);
    return (
      <button id={id} onClick={() => setCount((previous) => previous + 1)}>
        {count}
      </button>
    );
  }

  function App() {
    return (
      <div>
        <Counter id="first" />
        <Counter id="second" />
      </div>
    );
  }

  it("keeps state independent across separate instances of the same component", async () => {
    ToyReact.render(<App />, root.current);
    await waitForRender();

    expect(root.current.querySelector("#first")?.textContent).toBe("0");
    expect(root.current.querySelector("#second")?.textContent).toBe("0");

    root.current.querySelector<HTMLButtonElement>("#first")!.click();
    await waitForRender();

    // clicking the first counter must not touch the second — each fiber
    // needs its own hooks array, not one shared across the render pass
    expect(root.current.querySelector("#first")?.textContent).toBe("1");
    expect(root.current.querySelector("#second")?.textContent).toBe("0");
  });
});

describe("list reconciliation with keys", () => {
  const root = createMountedRoot();

  function Counter({ label }: { label: string }) {
    const [count, setCount] = ToyReact.useState(0);
    return (
      <div>
        <span>{label}</span>
        <button onClick={() => setCount((previous) => previous + 1)}>
          {count}
        </button>
      </div>
    );
  }

  function CounterList() {
    const [labels, setLabels] = ToyReact.useState(["a", "b"]);

    return (
      <div>
        <button
          id="swap"
          onClick={() => setLabels((previous) => [...previous].reverse())}
        >
          swap
        </button>
        <div id="list">
          {labels.map((label) => (
            <Counter key={label} label={label} />
          ))}
        </div>
      </div>
    );
  }

  const counterElementByLabel = (label: string) =>
    getByText(root.current, label).closest("div")!;

  it("keeps each counter's state attached to its item when the list is reordered", async () => {
    ToyReact.render(<CounterList />, root.current);
    await waitForRender();

    // click a 4 times
    // click b 2 times
    for (let i = 0; i < 4; i++) {
      counterElementByLabel("a").querySelector("button")!.click();
      if (i % 2) counterElementByLabel("b").querySelector("button")!.click();
    }

    await waitForRender();

    // sanity check before the swap — confirms the clicks landed on the
    // counters we meant, before we go on to reorder them
    expect(
      counterElementByLabel("a").querySelector("button")?.textContent,
    ).toBe("4");
    expect(
      counterElementByLabel("b").querySelector("button")?.textContent,
    ).toBe("2");

    root.current.querySelector<HTMLButtonElement>("#swap")!.click();
    await waitForRender();

    expect(
      counterElementByLabel("b").querySelector("button")?.textContent,
    ).toBe("2");

    expect(
      counterElementByLabel("a").querySelector("button")?.textContent,
    ).toBe("4");
  });
});

describe("list reconciliation with keys, dom order", () => {
  const root = createMountedRoot();

  function Counter({ label }: { label: string }) {
    const [count, setCount] = ToyReact.useState(0);
    return (
      <div>
        <span>{label}</span>
        <button onClick={() => setCount((previous) => previous + 1)}>
          {count}
        </button>
      </div>
    );
  }

  function CounterList() {
    const [labels, setLabels] = ToyReact.useState(["a", "b"]);

    return (
      <div>
        <button
          id="swap"
          onClick={() => setLabels((previous) => [...previous].reverse())}
        >
          swap
        </button>
        <div id="list">
          {labels.map((label) => (
            <Counter key={label} label={label} />
          ))}
        </div>
      </div>
    );
  }

  it("actually reorders the dom, not just the attached state", async () => {
    ToyReact.render(<CounterList />, root.current);
    await waitForRender();

    const listElement = root.current.querySelector("#list")!;
    const labelsInDomOrder = () =>
      Array.from(listElement.children).map(
        (child) => child.querySelector("span")?.textContent,
      );

    expect(labelsInDomOrder()).toEqual(["a", "b"]);

    root.current.querySelector<HTMLButtonElement>("#swap")!.click();
    await waitForRender();

    expect(labelsInDomOrder()).toEqual(["b", "a"]);
  });

  it("finds the correct anchor when multiple items move past each other", async () => {
    function ReorderableList() {
      const [labels, setLabels] = ToyReact.useState(["a", "b", "c", "d"]);
      return (
        <div>
          <button
            id="reorder"
            onClick={() => setLabels(() => ["d", "c", "a", "b"])}
          >
            reorder
          </button>
          <div id="list">
            {labels.map((label) => (
              <Counter key={label} label={label} />
            ))}
          </div>
        </div>
      );
    }

    ToyReact.render(<ReorderableList />, root.current);
    await waitForRender();

    const listElement = root.current.querySelector("#list")!;
    const labelsInDomOrder = () =>
      Array.from(listElement.children).map(
        (child) => child.querySelector("span")?.textContent,
      );

    expect(labelsInDomOrder()).toEqual(["a", "b", "c", "d"]);

    root.current.querySelector<HTMLButtonElement>("#reorder")!.click();
    await waitForRender();

    expect(labelsInDomOrder()).toEqual(["d", "c", "a", "b"]);
  });
});

describe("commit-phase dom lookup through a bailed-out subtree", () => {
  const root = createMountedRoot();

  function StaticBranch() {
    return <span id="static-target">static</span>;
  }

  function ToggleButton() {
    const [isB, setIsB] = ToyReact.useState(false);
    return isB ? (
      <b onClick={() => setIsB(() => false)}>b-version</b>
    ) : (
      <em onClick={() => setIsB(() => true)}>em-version</em>
    );
  }

  function OuterWrapper() {
    return (
      <div>
        <ToggleButton />
        <StaticBranch />
      </div>
    );
  }

  it("keeps a bailed-out sibling's dom position correct after a type-changing placement", async () => {
    ToyReact.render(<OuterWrapper />, root.current);
    await waitForRender();

    const em = getByText(root.current, "em-version");
    em.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();

    const outerDiv = root.current.querySelector("div")!;
    const staticSpan = outerDiv.querySelector("#static-target")!;
    const bVersion = getByText(root.current, "b-version");

    // ToggleButton is listed before StaticBranch in jsx — its
    // replacement must land in that slot, not get pushed past the
    // untouched sibling
    expect(outerDiv.children[0]).toBe(bVersion);
    expect(outerDiv.children[1]).toBe(staticSpan);
  });
});

describe("commit-phase reprocessing of untouched siblings", () => {
  const root = createMountedRoot();

  function StaticFirst() {
    return <div>first</div>;
  }

  function StaticSecond() {
    return <h2>second</h2>;
  }

  function NestedCounter() {
    const [count, setCount] = ToyReact.useState(0);
    return (
      <button onClick={() => setCount((c) => c + 1)}>nested: {count}</button>
    );
  }

  function Middle() {
    return (
      <div>
        <NestedCounter />
      </div>
    );
  }

  function App() {
    return (
      <div>
        <StaticFirst />
        <StaticSecond />
        <Middle />
      </div>
    );
  }

  it("leaves untouched siblings in place when an unrelated deeply-nested update commits", async () => {
    ToyReact.render(<App />, root.current);
    await waitForRender();

    const outerDiv = root.current.querySelector("div")!;
    const first = getByText(root.current, "first");
    const second = getByText(root.current, "second");

    const button = getByText(root.current, "nested: 0");
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();

    // first/second were never touched by this update — an unrelated
    // update several levels deep in Middle/NestedCounter must not
    // reposition siblings that had nothing to do with it
    expect(Array.from(outerDiv.children).indexOf(first)).toBe(0);
    expect(Array.from(outerDiv.children).indexOf(second)).toBe(1);
  });
});

describe("repeated updates to the same fiber", () => {
  const root = createMountedRoot();

  function NestedCounter() {
    const [count, setCount] = ToyReact.useState(0);
    return (
      <button onClick={() => setCount((c) => c + 1)}>nested: {count}</button>
    );
  }

  it("keeps counting correctly across three consecutive updates", async () => {
    ToyReact.render(<NestedCounter />, root.current);
    await waitForRender();

    const button = root.current.querySelector("button")!;

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForRender();

    expect(button.textContent).toBe("nested: 3");
  });
});

describe("memo", () => {
  const root = createMountedRoot();

  it("does not re-render when props are shallow-equal", async () => {
    let childRenderCount = 0;

    const Child = ToyReact.memo(function Child({ text }: { text: string }) {
      childRenderCount++;
      return <span>{text}</span>;
    });

    function Parent() {
      const [count, setCount] = ToyReact.useState(0);
      return (
        <div>
          <button id="bump" onClick={() => setCount((prev) => prev + 1)}>
            bump
          </button>
          <Child text="shall-not-rerender" />
        </div>
      );
    }

    ToyReact.render(<Parent />, root.current);
    await waitForRender();
    expect(childRenderCount).toBe(1);

    root.current.querySelector<HTMLButtonElement>("#bump")!.click();
    await waitForRender();

    // parent re-rendered (count changed) but Child's props didn't
    expect(childRenderCount).toBe(1);
    expect(root.current.querySelector("span")!.textContent).toBe(
      "shall-not-rerender",
    );
  });

  it("re-renders when props change", async () => {
    let childRenderCount = 0;

    const Child = ToyReact.memo(function Child({ label }: { label: string }) {
      childRenderCount++;
      return <span>{label}</span>;
    });

    function Parent() {
      const [label, setLabel] = ToyReact.useState("a");
      return (
        <div>
          <button id="change-label" onClick={() => setLabel(() => "b")}>
            change label
          </button>
          <Child label={label} />
        </div>
      );
    }

    ToyReact.render(<Parent />, root.current);
    await waitForRender();
    expect(childRenderCount).toBe(1);

    root.current.querySelector<HTMLButtonElement>("#change-label")!.click();
    await waitForRender();

    expect(childRenderCount).toBe(2);
    expect(root.current.querySelector("span")!.textContent).toBe("b");
  });

  it("uses a custom compare function when provided", async () => {
    let childRenderCount = 0;

    const Child = ToyReact.memo(
      function Child({ id, label }: { id: number; label: string }) {
        childRenderCount++;
        return <span>{label}</span>;
      },
      (prevProps, nextProps) => prevProps.id === nextProps.id,
    );

    function Parent() {
      const [label, setLabel] = ToyReact.useState("a");
      return (
        <div>
          <button id="change-label" onClick={() => setLabel(() => "b")}>
            change label
          </button>
          <Child id={1} label={label} />
        </div>
      );
    }

    ToyReact.render(<Parent />, root.current);
    await waitForRender();
    expect(childRenderCount).toBe(1);

    root.current.querySelector<HTMLButtonElement>("#change-label")!.click();
    await waitForRender();

    // custom compare only looks at id, which didn't change — bails out
    // even though label did
    expect(childRenderCount).toBe(1);
    expect(root.current.querySelector("span")!.textContent).toBe("a");
  });
});
