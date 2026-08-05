import { describe, expect, it } from "vitest";
import { createMountedRoot, waitForRender } from "./toy-react.test-utils";
import { getByText } from "@testing-library/dom";
import * as ToyReact from "./toy-react";

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
