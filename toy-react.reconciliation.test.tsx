import { describe, expect, it } from "vitest";
import { createMountedRoot, waitForRender } from "./toy-react.test-utils";
import { getByText } from "@testing-library/dom";
import * as ToyReact from "./toy-react";

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
