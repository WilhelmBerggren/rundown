export interface ParsedMarkupCell {
  kind: 'markup';
  source: string;
}

export interface ParsedCodeCell {
  kind: 'code';
  source: string;
  output?: string;
}

export type ParsedCell = ParsedMarkupCell | ParsedCodeCell;

export function parseMd(content: string): ParsedCell[] {
  const lines = content.split('\n');
  const cells: ParsedCell[] = [];
  let markupLines: string[] = [];
  let i = 0;

  function flushMarkup() {
    const text = markupLines.join('\n').trim();
    if (text) cells.push({ kind: 'markup', source: text });
    markupLines = [];
  }

  while (i < lines.length) {
    const line = lines[i];
    const codeMatch = /^```(sh|bash)\s*$/.exec(line);

    if (codeMatch) {
      flushMarkup();
      i++;
      const codeLines: string[] = [];
      while (i < lines.length && lines[i] !== '```') {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```

      const codeCell: ParsedCodeCell = { kind: 'code', source: codeLines.join('\n') };
      cells.push(codeCell);

      // Look ahead for optional "output:" label and/or output fence
      let j = i;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length && lines[j].trim() === 'output:') {
        j++;
        while (j < lines.length && lines[j].trim() === '') j++;
      }
      if (j < lines.length && lines[j] === '```output') {
        i = j + 1;
        const outputLines: string[] = [];
        while (i < lines.length && lines[i] !== '```') {
          outputLines.push(lines[i]);
          i++;
        }
        i++; // skip closing ```
        codeCell.output = outputLines.join('\n') + '\n';
      }
    } else {
      markupLines.push(line);
      i++;
    }
  }

  flushMarkup();
  return cells;
}

export function serializeCells(cells: ParsedCell[]): string {
  const parts: string[] = [];

  for (const cell of cells) {
    if (cell.kind === 'markup') {
      const source = cell.source.replace(/^\n+|\n+$/g, '');
      if (source) parts.push(source);
    } else {
      const source = cell.source.replace(/^\n+|\n+$/g, '');
      let block = '```sh\n' + source + '\n```';
      if (cell.output !== undefined) {
        block += '\n\n```output\n' + cell.output + '```';
      }
      parts.push(block);
    }
  }

  return parts.length > 0 ? parts.join('\n\n') + '\n' : '';
}
