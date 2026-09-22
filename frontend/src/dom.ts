export function requireElement<Element extends HTMLElement>(
  root: ParentNode,
  selector: string,
): Element {
  const element = root.querySelector<Element>(selector);
  if (element === null) {
    throw new Error(`Expected element matching "${selector}" in the document`);
  }
  return element;
}
