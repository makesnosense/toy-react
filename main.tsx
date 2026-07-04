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
    </div>
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
