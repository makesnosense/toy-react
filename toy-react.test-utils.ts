import { afterEach, beforeEach } from "vitest";
import {
  __isSchedulerIdleForTesting,
  __resetInternalStateForTesting,
} from "./toy-react";

// one macrotask tick
export const waitForRender = () =>
  new Promise<void>((resolve) => {
    const nodeSetImmediate = (
      globalThis as unknown as { setImmediate: (callback: () => void) => void }
    ).setImmediate;
    nodeSetImmediate(resolve);
  });

export async function waitForIdle(): Promise<void> {
  while (!__isSchedulerIdleForTesting()) {
    await waitForRender();
  }
}

// mounts a fresh dom root for a test, attached to document.body so
// Node.isConnected reports true, and resets toy-react's internal module
// state between tests
export function setupTest() {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(async () => {
    while (!__isSchedulerIdleForTesting()) {
      await waitForRender();
    }
    root.remove();
    __resetInternalStateForTesting();
  });

  return {
    get current() {
      return root;
    },
  };
}
