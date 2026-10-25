---
name: Reconciliation upload policy
description: Historical reconciliation dates and the one-upload-per-date business rule.
---

Reconciliation must be uploadable for any past date. The user states: "Only criteria is I cannot upload reconciliation twice for the same date."

**Why:** The user explicitly set this business rule; historical dates must not be limited to today or an arbitrary lookback period.

**How to apply:** Preserve historical-date access and enforce the one-upload-per-business-date rule in both the interface and server. Do not silently append or overwrite an existing date's uploaded reconciliation.

The one-upload rule refers to the source invoice workbook, not the bank statement or later payment allocations, denomination counts and matching work.

**Why:** Staff must still be able to finish reconciling an already imported day. Blocking all subsequent saves would make the ordinary reconciliation workflow unusable.

**How to apply:** Keep invoice-source replacement separate from ordinary adjustments. Existing populated historical records count as already uploaded even when they predate explicit upload receipts.
