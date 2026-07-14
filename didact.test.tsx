import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Didact from "./didact";

// one macrotask tick, so the shimmed requestIdleCallback in vitest.setup.ts
// gets a chance to run and commit the fiber tree
const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 0));

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
