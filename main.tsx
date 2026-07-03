import * as Didact from "./didact";

const element = (
  <div>
    <h1 title="foo">
      Hello <span>sick sad</span> world
    </h1>
    <h2>dddd</h2>
  </div>
);

console.log("Element produced by JSX:\n", JSON.stringify(element, null, 2));

const root = document.getElementById("root");

if (root) {
  Didact.render(element, root);
}

// exposes Didact for manual console testing
(window as any).Didact = Didact;
(window as any).container = root;
