// Synthetic, non-customer data for the dispatch browser regression test.
import { mkdir, writeFile } from 'node:fs/promises';
const lines = [
  'THE ARUN TEX', 'Invoice Number: TEST-PDF-20261024', 'Invoice Date: 24-Oct-2026',
  `IRN: ${'abcdef0123456789'.repeat(4)}`, 'E-way Bill No: 123456789012',
  'Bill To:', 'Example Buyer', '12 Market Street', 'Surat 395001',
  'GSTIN: 24ABCDE1234F1Z5', 'Phone: 9876543210',
  'Ship To:', 'Example Warehouse', '44 Industrial Road', 'Mumbai 400001',
  'GSTIN: 27ABCDE1234F1Z5', 'Description of Goods', 'Fabric',
];
const stream = `BT /F1 10 Tf 40 800 Td 16 TL\n${lines.map((line,i)=>`${i?'T* ':''}(${line}) Tj`).join('\n')}\nET`;
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
for (const [i,object] of objects.entries()) {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i+1} 0 obj\n${object}\nendobj\n`;
}
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
await mkdir('generated-artifacts/dispatch-tests',{recursive:true});
await writeFile('generated-artifacts/dispatch-tests/invoice.pdf',pdf);
console.log('Synthetic fixture: generated-artifacts/dispatch-tests/invoice.pdf');
