import * as Didact from "./didact";

function App() {
  const [hasSwapped, setHasSwapped] = Didact.useState(false);

  return (
    <div>
      <button onClick={() => setHasSwapped((previous) => !previous)}>
        Swap
      </button>
      {hasSwapped ? <span>changed</span> : <p>original</p>}
      <h2 style="background-color:pink">unchanged content</h2>
    </div>
  );
}

const root = document.getElementById("root");

if (root) {
  Didact.render(<App />, root);
}

(window as any).Didact = Didact;
(window as any).container = root;
