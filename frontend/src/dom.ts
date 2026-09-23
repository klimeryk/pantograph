export function requireElement<Found extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): Found {
  const element = root.querySelector<Found>(selector);
  if (element === null) {
    throw new Error(`Expected element matching "${selector}" in the document`);
  }
  return element;
}
