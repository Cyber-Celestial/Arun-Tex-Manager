import { createCanvas } from '@napi-rs/canvas';

// Synthetic data only. Generate true image-only and selectable-text PDFs from
// the same invoice, so the fallback is exercised without retaining real invoices.
export const fixtureIrn = 'abcdef0123456789'.repeat(4);
export const invoiceLines = [
  'THE ARUN TEX', 'Invoice Number: SCAN-2026/001', 'Invoice Date: 24/10/2026',
  `IRN: ${fixtureIrn.slice(0, 32)}`, fixtureIrn.slice(32),
  'E-way Bill No: 123456789012',
  'Bill To:', 'Example Buyer', '12 Market Street', 'Surat 395001',
  'GSTIN: 24ABCDE1234F1Z5', 'Phone: 9876543210',
  'Ship To:', 'Example Warehouse', '44 Industrial Road', 'Mumbai 400001',
  'GSTIN: 27ABCDE1234F1Z5', 'Phone: 9876543211',
  'Description of Goods', 'Cotton Fabric',
];

function pdf(objects: (string | Buffer)[]) {
  const chunks = [Buffer.from('%PDF-1.4\n')];
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n'));
  }
  const xref = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${
    offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
  }trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Uint8Array(Buffer.concat(chunks));
}

export function invoicePdfFixture(scanned: boolean, lines = invoiceLines) {
  let content: string;
  let resource: string;
  let extra: string | Buffer;
  if (scanned) {
    const canvas = createCanvas(1800, 2400);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1800, 2400);
    ctx.fillStyle = 'black'; ctx.font = '32px DejaVu Sans';
    lines.forEach((line, i) => ctx.fillText(line, 110, 130 + i * 72));
    const jpeg = canvas.toBuffer('image/jpeg', 95);
    extra = Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width 1800 /Height 2400 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`),
      jpeg, Buffer.from('\nendstream'),
    ]);
    resource = '/XObject << /Scan 5 0 R >>';
    content = 'q 600 0 0 800 0 0 cm /Scan Do Q';
  } else {
    extra = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    resource = '/Font << /F1 5 0 R >>';
    const escaped = lines.map(line => line.replace(/[\\()]/g, '\\$&'));
    content = `BT /F1 11 Tf 36 760 Td 24 TL ${escaped.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n')} ET`;
  }
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << ${resource} >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    extra,
  ]);
}
