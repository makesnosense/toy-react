interface DidactElement {
  type: string;
  props: DidactElementProps;
}

interface DidactElementProps {
  [key: string]: unknown;
  children: DidactElement[];
}
// names the category "a thing that can occupy a renderable position"
// agnostic to whether the specific instance is object-shaped or primitive-shaped.
type DidactNode = DidactElement | string | number;

export const createElement = (
  type: string,
  props: Record<string, unknown> | null,
  ...children: DidactNode[]
): DidactElement => ({
  type,
  props: {
    ...props,
    children: children.map((child) =>
      typeof child === "object" ? child : createTextElement(child),
    ),
  },
});

export const createTextElement = (child: string | number) => ({
  type: "TEXT_ELEMENT",
  props: { nodeValue: child, children: [] },
});

export function render(element: DidactElement, container: HTMLElement): void {
  if (element.type === "TEXT_ELEMENT") {
    const dom = document.createTextNode(String(element.props.nodeValue));
    container.appendChild(dom);
    return;
  }

  const dom = document.createElement(element.type);

  const isProp = (key: string) => key !== "children";

  Object.keys(element.props)
    .filter(isProp)
    .forEach((name) => {
      // @ts-expect-error — dynamic prop assignment, to revisit later
      dom[name] = element.props[name];
    });

  element.props.children.forEach((child) => render(child, dom));

  container.appendChild(dom);
}
