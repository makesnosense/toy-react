export const createElement = (
  type: string,
  props: Record<string, unknown> | null,
  ...children: unknown[]
) => {
  return { type, props, children };
};
