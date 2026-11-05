export interface Token {
  value: string;
  start: number;
  end: number;
}
/** One lexer shared by execution and completion; quoted arguments support escaped quotes. */
export function parseCommand(line: string, partial = false): Token[] {
  if (line.length > 1024)
    throw new Error("Command is te lang (maximaal 1024 tekens).");
  const result: Token[] = [];
  let i = line.startsWith("/") ? 1 : 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) {
      i++;
      continue;
    }
    const start = i;
    let value = "",
      quote = "";
    while (i < line.length) {
      const c = line[i++];
      if (c === "\\" && quote && i < line.length) {
        value += line[i++];
        continue;
      }
      if (c === '"' || c === "'") {
        if (!quote) quote = c;
        else if (quote === c) quote = "";
        else value += c;
      } else if (!quote && /\s/.test(c)) {
        i--;
        break;
      } else value += c;
    }
    if (quote && !partial) throw new Error("Sluit het aanhalingsteken.");
    result.push({ value, start, end: i });
  }
  return result;
}
