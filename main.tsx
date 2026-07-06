import * as Didact from "./didact";

function App() {
  return (
    <div>
      <JustAComponent />
      <VeryInput />
    </div>
  );
}

function JustAComponent() {
  return (
    <div>
      <h1 title="foo">
        Hello <span>sick sad</span> world
      </h1>
      <h2>dddd</h2>
      <Counter />
    </div>
  );
}

function Counter() {
  const [count, setCount] = Didact.useState(0);

  console.log("Counter render, count is:", count);

  return (
    <h1>
      <button onClick={() => setCount((previousCount) => previousCount + 1)}>
        Increment
      </button>
      <div>Count: {count}</div>
    </h1>
  );
}

function VeryInput() {
  return <input></input>;
}

const root = document.getElementById("root");

if (root) {
  Didact.render(<App />, root);
}

// exposes Didact for manual console testing
(window as any).Didact = Didact;
(window as any).container = root;
