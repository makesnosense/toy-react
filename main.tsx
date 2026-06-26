// import * as Didact from "./didact";

// const element = <h1 title="foo">Hello world1</h1>;

const element = {
  type: "h1",
  props: {
    title: "foo",
    children: ["Hello world1"],
  },
};

// console.log("Element produced by JSX:", element);

const root = document.getElementById("root");

const node = document.createElement(element.type);
node["title"] = element.props.title;

// NOTE!
// why not node.innerText:
// cause we want to have reference for a created child
// and node.innerText just sets the string.
// it's a property mutation, not a node-producing operation

// why not node.innerHTML = "Hello":
// innerHTML produces new nodes, but we do not get refences to them
// we'd have to go fish for it via node.firstChild or a querySelector,
// which is exactly the kind of re-discovery the fiber model is designed to avoid

// and also XSS textbook case

const text = document.createTextNode("");
text["nodeValue"] = element.props.children[0];

node.appendChild(text);

root.appendChild(node);

// if (root) {
//   // root.textContent = "Hello world";
// }
