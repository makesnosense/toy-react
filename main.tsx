import * as ToyReact from "./toy-react";

function NestedCounter() {
  const [count, setCount] = ToyReact.useState(0);
  return (
    <button onClick={() => setCount((c) => c + 1)}>nested: {count}</button>
  );
}

function Middle() {
  return (
    <div>
      <NestedCounter />
    </div>
  );
}

function ToggleSection({ isOriginalOrder }: { isOriginalOrder: boolean }) {
  return isOriginalOrder ? <div>1. original</div> : <span>1. changed</span>;
}

const unchangedHeading = (
  <h2 style="background-color:pink">2. unchanged content</h2>
);

function App() {
  const [isOriginalOrder, setIsOriginalOrder] = ToyReact.useState(true);

  return (
    <div>
      <button
        style="display:block; margin-bottom:8px"
        onClick={() => {
          console.log("Swap clicked");
          setIsOriginalOrder((previous) => !previous);
        }}
      >
        Swap
      </button>
      <ToggleSection isOriginalOrder={isOriginalOrder} />
      {unchangedHeading}
      <Middle />
    </div>
  );
}

const root = document.getElementById("root");

if (root) {
  ToyReact.render(<App />, root);
}

(window as any).ToyReact = ToyReact;
(window as any).container = root;
