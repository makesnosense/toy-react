// jsdom has no requestIdleCallback (jsdom/jsdom#3943), and didact.ts calls
// it on the global directly, so tests need a stand-in.
//
// timeRemaining() always returns a positive number here, so workLoop never
// yields mid-tree — the whole render finishes inside one callback. that
// callback is scheduled via setTimeout rather than run synchronously,
// because workLoop reschedules itself unconditionally at the end of every
// pass — calling it synchronously here would recurse forever in one stack.
if (!("requestIdleCallback" in globalThis)) {
  globalThis.requestIdleCallback = (callback) => {
    setTimeout(() => {
      callback({ didTimeout: false, timeRemaining: () => 50 });
    }, 0);
    return 0;
  };
}
