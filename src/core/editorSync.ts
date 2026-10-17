/** Update only the changed text, keeping carets and selections in untouched text. */
export function minimalTextChange(current: string, next: string) {
  if (current === next) return undefined;
  let from = 0;
  const max = Math.min(current.length, next.length);
  while (from < max && current.charCodeAt(from) === next.charCodeAt(from)) from++;
  let to = current.length;
  let nextTo = next.length;
  while (to > from && nextTo > from && current.charCodeAt(to - 1) === next.charCodeAt(nextTo - 1)) {
    to--;
    nextTo--;
  }
  return { from, to, insert: next.slice(from, nextTo) };
}
