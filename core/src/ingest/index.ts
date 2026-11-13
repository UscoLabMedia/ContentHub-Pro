// Reads CSV / PDF / screenshots LOCALLY (no tokens spent). Only the compact digest goes to the AI.
import Papa from 'papaparse';
import { buildDigest, rowFromText, rowsFromRecords, type Digest } from './metrics.ts';

export interface IngestInput {
  name: string;
  bytes: Uint8Array;
}

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  return parts.join('\n');
}

async function imageText(bytes: Uint8Array): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  // First run downloads language data (cached afterwards); set CHP_TESSDATA to a local folder to work fully offline.
  const worker = await createWorker(['spa', 'eng'], 1, process.env.CHP_TESSDATA ? { langPath: process.env.CHP_TESSDATA } : {});
  try {
    const { data } = await worker.recognize(Buffer.from(bytes));
    return data.text;
  } finally {
    await worker.terminate();
  }
}

export async function ingestFile(file: IngestInput): Promise<Digest> {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
    const parsed = Papa.parse<Record<string, unknown>>(new TextDecoder().decode(file.bytes), {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: false,
    });
    return buildDigest(file.name, rowsFromRecords(parsed.data));
  }
  if (ext === 'pdf') return buildDigest(file.name, [rowFromText(await pdfToText(file.bytes))]);
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return buildDigest(file.name, [rowFromText(await imageText(file.bytes))]);
  throw new Error(`Unsupported file type: .${ext}`);
}

export * from './metrics.ts';
