// Minimal RFC 4180 CSV reader for the geography seed (I-03): UTF-8, optional BOM, quoted fields,
// doubled quotes, CRLF or LF. No dependency needed for these small, controlled files.

export interface CsvTable {
  header: string[];
  /** Data rows with their 1-based line number in the file (header is line 1). */
  rows: { line: number; values: string[] }[];
}

export function parseCsv(text: string): CsvTable {
  const src = text.startsWith('﻿') ? text.slice(1) : text;
  const records: { line: number; values: string[] }[] = [];
  let field = '';
  let values: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let fieldStarted = false;

  const endField = () => {
    values.push(field);
    field = '';
    fieldStarted = false;
  };
  const endRecord = () => {
    endField();
    if (!(values.length === 1 && values[0] === '')) records.push({ line: recordLine, values });
    values = [];
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += c;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new Error(`unterminated quoted field starting on line ${recordLine}`);
  if (field !== '' || values.length > 0) endRecord();

  const [head, ...rows] = records;
  return { header: head ? head.values.map((h) => h.trim()) : [], rows };
}
