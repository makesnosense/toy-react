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
