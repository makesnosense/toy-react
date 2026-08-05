import { describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/dom";
import { setupTest, waitForRender } from "./toy-react.test-utils";
import * as ToyReact from "./toy-react";

describe("work loop scheduling", () => {
  const containerA = setupTest();
  const containerB = setupTest();

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
  const root = setupTest();

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
  const root = setupTest();

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
  const root = setupTest();

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
