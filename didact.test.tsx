import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getByText } from "@testing-library/dom";
import * as Didact from "./didact";

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
    const Didact = await import("./didact");

    Didact.render(<div />, containerA.current);
    Didact.render(<div />, containerB.current);

    expect(setImmediateSpy).toHaveBeenCalledTimes(1);

    // let the one real pending performWorkUntilDeadline actually run and
    // settle, instead of leaving it dangling on the event loop past this
    // test's end
    await waitForRender();

    setImmediateSpy.mockRestore();
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
    Didact.render(<App />, root.current);
    await waitForRender();

    expect(root.current.querySelector("h1")?.textContent).toBe("hello");
  });
});

describe("dom insertion order", () => {
  const root = createMountedRoot();

  function ToggleSection({ showAsDiv }: { showAsDiv: boolean }) {
    return showAsDiv ? <div>section</div> : <span>section</span>;
  }

  function App() {
    const [showAsDiv, setShowAsDiv] = Didact.useState(true);
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
    Didact.render(<App />, root.current);
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
    const [count, setCount] = Didact.useState(0);
    const [label, setLabel] = Didact.useState("a");

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
    Didact.render(<Counters />, root.current);
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
    const [count, setCount] = Didact.useState(0);
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
    Didact.render(<App />, root.current);
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
    const [count, setCount] = Didact.useState(0);
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
    const [labels, setLabels] = Didact.useState(["a", "b"]);

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
    Didact.render(<CounterList />, root.current);
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
    const [count, setCount] = Didact.useState(0);
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
    const [labels, setLabels] = Didact.useState(["a", "b"]);

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
    Didact.render(<CounterList />, root.current);
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
      const [labels, setLabels] = Didact.useState(["a", "b", "c", "d"]);
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

    Didact.render(<ReorderableList />, root.current);
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
    const [isB, setIsB] = Didact.useState(false);
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
    Didact.render(<OuterWrapper />, root.current);
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
