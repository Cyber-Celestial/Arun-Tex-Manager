import { test, expect } from '@playwright/test';
import { clerkSetup, setupClerkTestingToken } from '@clerk/testing/playwright';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { environment } from './environment.mjs';

const fixture = resolve(import.meta.dirname, '../../generated-artifacts/dispatch-tests/invoice.pdf');
const irn = 'abcdef0123456789'.repeat(4);
const corrected = {
  invoiceNumber: 'TEST-PDF-CORRECTED',
  customerName: 'Example Buyer Corrected',
  shipToDetails: 'Example Warehouse\n44 Corrected Road\nMumbai 400001',
};

async function login(browser, env, role) {
  const context = await browser.newContext({ baseURL: env.baseURL });
  try {
    await setupClerkTestingToken({ context });
    const page = await context.newPage();
    await page.goto('/dispatch');
    await page.waitForFunction(() => window.Clerk?.loaded);
    // Exercise real Clerk sessions; never install a test-only authentication bypass.
    await page.evaluate(async ticket => {
      const result = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket });
      if (result.status !== 'complete') throw new Error('Synthetic sign-in did not complete');
      await window.Clerk.setActive({ session: result.createdSessionId });
    }, await env.ticket(role));
    await page.goto('/dispatch');
    return { context, page };
  } catch (error) {
    await context.close();
    throw error;
  }
}

// Same-origin cookie authentication, exactly as the application's fetch client
// uses. These requests bypass UI guards, not auth or server validation.
async function api(page, path, method = 'GET', data) {
  return page.evaluate(async ({ path, method, data }) => {
    const response = await fetch(path, {
      method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json() };
  }, { path, method, data });
}

async function state(page) {
  const response = await api(page, '/api/workspace/state');
  expect(response.status).toBe(200);
  return response.data;
}

async function saveReview(page) {
  await page.getByRole('checkbox', { name: 'I have checked' }).check();
  const saved = page.waitForResponse(r => r.url().endsWith('/api/workspace/data/dispatch') && r.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Save reviewed invoice' }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'Review / correct invoice' })).toBeHidden();
}

test('private invoice upload → review → persistence → compliance → exact label PDF', async ({ browser }) => {
  const env = await environment();
  const contexts = [];
  try {
    await clerkSetup({ publishableKey: process.env.VITE_CLERK_PUBLISHABLE_KEY });
    const { page, context } = await login(browser, env, 'billing');
    contexts.push(context);
    await expect(page.getByRole('heading', { name: 'Dispatch checklist' })).toBeVisible();
    expect((await state(page)).dispatch.invoices).toEqual([]);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await test.step('real PDF worker extraction, private upload and mandatory review', async () => {
      await page.getByRole('button', { name: '+ Add B2B invoice' }).click();
      await page.locator('input[type=file]').setInputFiles(fixture);
      await expect(page.getByRole('status')).toHaveText('PDF extracted. Correct the fields below before saving.');
      await expect(page.getByLabel('Invoice number', { exact: true })).toHaveValue('TEST-PDF-20261024');
      await expect(page.getByLabel('Invoice date', { exact: true })).toHaveValue('2026-10-24');
      await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Example Buyer');
      await expect(page.getByLabel('E-invoice IRN', { exact: true })).toHaveValue(irn);
      await expect(page.getByLabel('E-way bill number', { exact: true })).toHaveValue('123456789012');
      expect(await page.getByLabel('Ship-to details', { exact: true }).inputValue()).toContain('44 Industrial Road');
      await expect(page.getByRole('button', { name: 'Save reviewed invoice' })).toBeDisabled();

      // Invalid IDs stay blocked even after the operator confirms review.
      for (const [label, value, message] of [
        ['E-invoice IRN', 'not-an-irn', 'IRN must contain exactly 64 hexadecimal characters.'],
        ['E-way bill number', '123', 'E-way bill number must contain exactly 12 digits.'],
      ]) {
        const input = page.getByLabel(label, { exact: true });
        const original = await input.inputValue();
        await input.fill(value);
        await page.getByRole('checkbox', { name: 'I have checked' }).check();
        await expect(page.getByRole('button', { name: 'Save reviewed invoice' })).toBeDisabled();
        await expect(page.getByText(message, { exact: true })).toBeVisible();
        await input.fill(original);
      }
      await page.getByLabel('Invoice number', { exact: true }).fill(corrected.invoiceNumber);
      await page.getByLabel('Customer name', { exact: true }).fill(corrected.customerName);
      await page.getByLabel('Ship-to details', { exact: true }).fill(corrected.shipToDetails);
      await saveReview(page);
    });

    let persisted;
    await test.step('reload and reopen prove corrected values and original PDF persist', async () => {
      await page.reload();
      const card = page.locator('.dispatch-card').filter({ hasText: corrected.invoiceNumber });
      await expect(card).toContainText(corrected.customerName);
      await card.getByRole('button', { name: 'Review / correct invoice' }).click();
      for (const [label, value] of [
        ['Invoice number', corrected.invoiceNumber], ['Customer name', corrected.customerName],
        ['Ship-to details', corrected.shipToDetails], ['E-invoice IRN', irn],
        ['E-way bill number', '123456789012'],
      ]) await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
      const original = page.getByRole('link', { name: 'Open original invoice PDF' });
      const documentPath = await original.getAttribute('href');
      expect(documentPath).toMatch(/^\/api\/storage\/objects\/uploads\/[a-f0-9-]{36}$/);
      const response = await context.request.get(documentPath);
      expect(response.status()).toBe(200);
      expect(response.headers()['cache-control']).toMatch(/^private/);
      expect(response.headers()['content-type']).toContain('application/pdf');
      expect(await response.body()).toEqual(await readFile(fixture));
      const anonymous = await browser.newContext({ baseURL: env.baseURL });
      try {
        expect((await anonymous.request.get(documentPath)).status()).toBe(401);
        expect((await anonymous.request.post('/api/storage/uploads/request-url', {
          data: { name: 'invoice.pdf', size: 100, contentType: 'application/pdf' },
        })).status()).toBe(401);
      } finally { await anonymous.close(); }
      const pending = await login(browser, env, 'pending');
      contexts.push(pending.context);
      expect((await api(pending.page, documentPath)).status).toBe(403);
      expect((await api(pending.page, '/api/storage/uploads/request-url', 'POST', {
        name: 'invoice.pdf', size: 100, contentType: 'application/pdf',
      })).status).toBe(403);
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      persisted = await state(page);
      expect(persisted.dispatch.invoices).toHaveLength(1);
      expect(persisted.dispatch.invoices[0]).toMatchObject({
        ...corrected, invoicePdfObjectPath: documentPath.replace('/api/storage', ''), status: 'Pending',
      });
    });

    await test.step('direct API attempts cannot bypass compliance validation', async () => {
      const invoice = persisted.dispatch.invoices[0];
      const complete = {
        ...invoice, status: 'Completed', eInvoiceDone: true, eWayDone: true,
        bundleDone: true, whatsappSent: true, courierSent: true, vastraCourierUpdated: true,
        lrNumber: 'SYNTHETIC-LR', lrPdfObjectPath: invoice.invoicePdfObjectPath,
        courierPdfObjectPath: invoice.invoicePdfObjectPath,
      };
      // Both empty and malformed IDs, plus done flags while still Pending.
      for (const patch of [
        { eInvoiceIrn: '' }, { eInvoiceIrn: 'g'.repeat(64) },
        { eWayBillNumber: '' }, { eWayBillNumber: '123' },
        { status: 'Pending', eInvoiceIrn: '', eInvoiceDone: true },
        { status: 'Pending', eWayBillNumber: '', eWayDone: true },
      ]) {
        const result = await api(page, '/api/workspace/data/dispatch', 'PUT', {
          expectedVersion: persisted.version, data: { invoices: [{ ...complete, ...patch }] },
        });
        expect(result.status).toBe(400);
        expect(result.data.error).toMatch(/IRN|e-way bill|cannot be completed/i);
        const unchanged = await state(page);
        expect(unchanged.version).toBe(persisted.version);
        expect(unchanged.dispatch).toEqual(persisted.dispatch);
      }
      // Empty IDs may be saved Pending, but the UI must refuse Done.
      const pending = { ...invoice, eInvoiceIrn: '', eWayBillNumber: '', eInvoiceDone: false, eWayDone: false };
      expect((await api(page, '/api/workspace/data/dispatch', 'PUT', {
        expectedVersion: persisted.version, data: { invoices: [pending] },
      })).status).toBe(200);
      await page.reload();
      for (const [id, message] of [
        ['eInvoiceDone', 'Enter and review a valid 64-character IRN before marking E-invoice done.'],
        ['eWayDone', 'Enter and review a valid 12-digit e-way bill number before marking E-way bill done.'],
      ]) {
        await page.getByTestId(`button-dispatch-${id}-0`).click();
        await expect(page.getByRole('alert')).toHaveText(message);
        await expect(page.getByTestId(`button-dispatch-${id}-0`)).not.toHaveClass(/checked/);
      }
      const current = await state(page);
      expect(current.dispatch.invoices[0].status).toBe('Pending');
      // Positive control: validation is not simply rejecting every write.
      expect((await api(page, '/api/workspace/data/dispatch', 'PUT', {
        expectedVersion: current.version, data: { invoices: [complete] },
      })).status).toBe(200);
      expect((await state(page)).dispatch.invoices[0].status).toBe('Completed');
      await page.reload();
    });

    await test.step('print action produces one 288×144-point page containing only the label', async () => {
      await page.locator('.dispatch-card').getByRole('button', { name: 'Print label', exact: true }).click();
      await page.evaluate(() => { window.__printCalls = 0; window.print = () => window.__printCalls++; });
      await page.getByRole('button', { name: 'Print 4×2 labels' }).click();
      expect(await page.evaluate(() => window.__printCalls)).toBe(1);
      const buffer = await page.pdf({
        preferCSSPageSize: true, displayHeaderFooter: false, printBackground: true,
      });
      const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const loading = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
      const pdf = await loading.promise;
      try {
        expect(pdf.numPages).toBe(1);
        const label = await pdf.getPage(1);
        expect(label.view).toEqual([0, 0, 288, 144]);
        const content = await label.getTextContent();
        const text = content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim();
        // Every printed fragment must be label content, not hidden app chrome.
        const expected = [
          'THE ARUN TEX', 'COURIER / B2B', `INV ${corrected.invoiceNumber}`, '2026-10-24',
          corrected.customerName, 'BILL TO', 'Example Buyer', '12 Market Street', 'Surat 395001',
          'GSTIN: 24ABCDE1234F1Z5', 'Ph: 9876543210', 'SHIP TO', 'Example Warehouse',
          '44 Corrected Road', 'Mumbai 400001', 'GSTIN: 27ABCDE1234F1Z5',
          'LR:', 'SYNTHETIC-LR', 'EWB:', '123456789012',
        ];
        for (const fragment of expected) expect(text).toContain(fragment);
        expect(text).not.toMatch(/Dispatch checklist|Courier label preview|Print 4|Close preview|Dashboard|Ready to dispatch|Compliance before/);
        // Ensure the entire text fits inside the physical stock, not just the DOM preview.
        for (const item of content.items) {
          if (!item.str.trim()) continue;
          expect(item.transform[4]).toBeGreaterThanOrEqual(0);
          expect(item.transform[5]).toBeGreaterThanOrEqual(0);
          expect(item.transform[4] + item.width).toBeLessThanOrEqual(288.5);
          expect(item.transform[5]).toBeLessThanOrEqual(144);
        }
      } finally { await loading.destroy(); }
      await page.getByRole('button', { name: 'Close preview' }).click();
    });

    await test.step('long delivery details block printing without silent clipping', async () => {
      await page.getByRole('button', { name: 'Review / correct invoice' }).click();
      await page.getByLabel('Ship-to details', { exact: true }).fill('Long synthetic delivery address\n'.repeat(18));
      await saveReview(page);
      await page.getByRole('button', { name: 'Print label', exact: true }).click();
      await page.getByRole('button', { name: 'Print 4×2 labels' }).click();
      await expect(page.getByRole('alert')).toContainText('A label is too long for 4×2 inches');
      expect(await page.evaluate(() => window.__printCalls)).toBe(1);
      await page.getByRole('button', { name: 'Close preview' }).click();
    });
    expect(errors).toEqual([]);
  } finally {
    try { await Promise.all(contexts.map(context => context.close())); }
    finally { await env.cleanup(); }
  }
});
