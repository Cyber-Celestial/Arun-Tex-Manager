import { copyFile, cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

// Serve all OCR dependencies from our own origin: no document processor or CDN.
export async function prepareOcrAssets(root: string) {
  const require = createRequire(import.meta.url);
  const workerRequire = createRequire(require.resolve('tesseract.js/package.json'));
  if (require('tesseract.js-core/package.json').version !== workerRequire('tesseract.js-core/package.json').version) {
    throw new Error('The self-hosted OCR core must match the version used by tesseract.js.');
  }
  const destination = path.join(root, 'public/ocr');
  await mkdir(destination, { recursive: true });
  const sources = [
    ['tesseract.js', 'dist/worker.min.js', 'worker.min.js'],
    ['tesseract.js-core', 'tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
    ['tesseract.js-core', 'tesseract-core-lstm.wasm', 'tesseract-core-lstm.wasm'],
    ['@tesseract.js-data/eng', '4.0.0/eng.traineddata.gz', 'eng.traineddata.gz'],
  ];
  for (const [pkg, source, target] of sources) {
    const packageRoot = path.dirname(require.resolve(`${pkg}/package.json`));
    await copyFile(path.join(packageRoot, source), path.join(destination, target));
  }
  // Scans may contain JPEG2000 or JBIG2 images instead of native JPEG/PNG.
  const pdfRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  await cp(path.join(pdfRoot, 'wasm'), path.join(destination, 'pdfjs'), { recursive: true });
}
