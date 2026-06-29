import * as Didact from "./didact";

const element = (
  <div>
    <h1 title="foo">Hello world</h1>
    <h2>dddd</h2>
  </div>
);

console.log("Element produced by JSX:\n", JSON.stringify(element, null, 2));

const root = document.getElementById("root");

if (root) {
  Didact.render(element, root);
}
