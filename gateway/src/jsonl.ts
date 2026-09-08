/** Parse a JSONL document, skipping blank and corrupt lines. */
export function parseJsonl<T>(raw: string): T[] {
  const events: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as T);
    } catch {
      /* skip corrupt line */
    }
  }
  return events;
}
