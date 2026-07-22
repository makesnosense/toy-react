import * as Didact from "./didact";

function ToggleSection({ isOriginalOrder }: { isOriginalOrder: boolean }) {
  return isOriginalOrder ? <div>1. original</div> : <span>1. changed</span>;
}

const unchangedHeading = (
  <h2 style="background-color:pink">2. unchanged content</h2>
);

function App() {
  const [isOriginalOrder, setIsOriginalOrder] = Didact.useState(true);

  return (
    <div>
      <button
        style="display:block; margin-bottom:8px"
        onClick={() => setIsOriginalOrder((previous) => !previous)}
      >
        Swap
      </button>
      <ToggleSection isOriginalOrder={isOriginalOrder} />
      {unchangedHeading}
    </div>
  );
}

const root = document.getElementById("root");

if (root) {
  Didact.render(<App />, root);
}

(window as any).Didact = Didact;
(window as any).container = root;
