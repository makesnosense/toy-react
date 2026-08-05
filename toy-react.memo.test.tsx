import { describe, expect, it } from "vitest";
import { setupTest, waitForIdle } from "./toy-react.test-utils";
import * as ToyReact from "./toy-react";

describe("memo", () => {
  const root = setupTest();

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
    await waitForIdle();
    expect(childRenderCount).toBe(1);

    root.current.querySelector<HTMLButtonElement>("#bump")!.click();
    await waitForIdle();

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
    await waitForIdle();
    expect(childRenderCount).toBe(1);

    root.current.querySelector<HTMLButtonElement>("#change-label")!.click();
    await waitForIdle();

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
    await waitForIdle();
    expect(childRenderCount).toBe(1);

    root.current.querySelector<HTMLButtonElement>("#change-label")!.click();
    await waitForIdle();

    // custom compare only looks at id, which didn't change — bails out
    // even though label did
    expect(childRenderCount).toBe(1);
    expect(root.current.querySelector("span")!.textContent).toBe("a");
  });
});
