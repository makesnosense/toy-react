declare namespace JSX {
  interface IntrinsicElements {
    // this exists to validate realistic props per tag (e.g. h1 vs a
    // accepting different prop shapes) — but here we do it super
    // permissively: any tag name, any props, no per-tag checking.
    // prop-value safety still happens inside createElement's own
    // parameter types, not here.
    [tagName: string]: any;
  }
}
