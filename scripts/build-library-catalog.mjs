// Regenerates the bundled LuxAlgo Library catalog. Source is the public list
// the Vela picker reads; only display fields are kept so the bundle stays small.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENDPOINT =
  'https://vela.luxalgo.com/api/quant/prod-library/api/library/indicators/query?pageIndex=0&pageQuantity=1000';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'luxalgoCatalog.json');
const DESCRIPTION_LIMIT = 240;

const response = await fetch(ENDPOINT);
if (!response.ok) throw new Error(`Library catalog request failed: ${response.status}`);
const payload = await response.json();
const rows = payload?.data?.indicators;
if (!Array.isArray(rows)) throw new Error('Library catalog response has no indicators');

const items = rows
  .map((row) => ({
    slug: String(row.slug ?? ''),
    name: String(row.name ?? ''),
    family: String(row.family ?? ''),
    date: String(row.creationDateDisplayed ?? ''),
    codeId: String(row.pineScriptCodeId ?? ''),
    imageUrl: String(row.imageUrl ?? ''),
    description: String(row.description ?? '').slice(0, DESCRIPTION_LIMIT).trim(),
  }))
  .filter((item) => item.slug && item.name && item.codeId)
  .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify({ source: 'https://www.luxalgo.com/library/', generatedAt: new Date().toISOString(), items }));
console.log(`[library] wrote ${items.length} indicators to ${OUT}`);
