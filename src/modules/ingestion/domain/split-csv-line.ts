/**
 * Splits one CSV line into fields, honouring RFC 4180 quoting within the line.
 *
 * Embedded newlines are deliberately not supported: the splitter upstream cuts
 * on `0x0A`, so a quoted newline would already have become two lines by the time
 * this sees them. That is the vendor contract rather than an oversight, and a row
 * containing one is rejected by column count instead of silently repaired.
 */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }

  fields.push(field);
  return fields;
}
