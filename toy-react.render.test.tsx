import { describe, expect, it } from "vitest";
import { setupTest, waitForRender } from "./toy-react.test-utils";
import * as ToyReact from "./toy-react";

describe("render", () => {
  const root = setupTest();

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
  const root = setupTest();

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
