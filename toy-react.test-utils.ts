import { afterEach, beforeEach } from "vitest";

// one macrotask tick
export const waitForRender = () =>
  new Promise<void>((resolve) => {
    const nodeSetImmediate = (
      globalThis as unknown as { setImmediate: (callback: () => void) => void }
    ).setImmediate;
    nodeSetImmediate(resolve);
  });

// a fresh dom node, attached to document.body so Node.isConnected reports
// true — attached and detached around every test via beforeEach/afterEach,
// so no test's dom can leak into another
export function createMountedRoot() {
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
