import { describe, expect, it } from "vitest";
import { setupTest, waitForIdle } from "./toy-react.test-utils";
import * as ToyReact from "./toy-react";

describe("multiple hooks in one component", () => {
  const root = setupTest();

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
    await waitForIdle();

    expect(root.current.querySelector("#countValue")?.textContent).toBe("0");
    expect(root.current.querySelector("#labelValue")?.textContent).toBe("a");

    root.current.querySelector<HTMLButtonElement>("#incrementCount")!.click();
    await waitForIdle();

    // only count should change here — if hook index tracking were broken,
    // this update could land on label's slot instead
    expect(root.current.querySelector("#countValue")?.textContent).toBe("1");
    expect(root.current.querySelector("#labelValue")?.textContent).toBe("a");

    root.current.querySelector<HTMLButtonElement>("#cycleLabel")!.click();
    await waitForIdle();

    expect(root.current.querySelector("#countValue")?.textContent).toBe("1");
    expect(root.current.querySelector("#labelValue")?.textContent).toBe("b");
  });
});

describe("multiple components using hooks", () => {
  const root = setupTest();

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
    await waitForIdle();

    expect(root.current.querySelector("#first")?.textContent).toBe("0");
    expect(root.current.querySelector("#second")?.textContent).toBe("0");

    root.current.querySelector<HTMLButtonElement>("#first")!.click();
    await waitForIdle();

    // clicking the first counter must not touch the second — each fiber
    // needs its own hooks array, not one shared across the render pass
    expect(root.current.querySelector("#first")?.textContent).toBe("1");
    expect(root.current.querySelector("#second")?.textContent).toBe("0");
  });
});

describe("repeated updates to the same fiber", () => {
  const root = setupTest();

  function NestedCounter() {
    const [count, setCount] = ToyReact.useState(0);
    return (
      <button onClick={() => setCount((c) => c + 1)}>nested: {count}</button>
    );
  }

  it("keeps counting correctly across three consecutive updates", async () => {
    ToyReact.render(<NestedCounter />, root.current);
    await waitForIdle();

    const button = root.current.querySelector("button")!;

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForIdle();

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForIdle();

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForIdle();

    expect(button.textContent).toBe("nested: 3");
  });
});

describe("useEffect", () => {
  const root = setupTest();

  it("runs the create callback after mount", async () => {
    let effectRan = false;

    function App() {
      ToyReact.useEffect(() => {
        effectRan = true;
      }, []);

      return <div>hello</div>;
    }

    ToyReact.render(<App />, root.current);
    await waitForIdle();

    expect(effectRan).toBe(true);
  });
});
