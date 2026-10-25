---
name: Reconciliation upload policy
description: Historical reconciliation dates and the one-upload-per-date business rule.
---

Reconciliation must be uploadable for any past date. The user states: "Only criteria is I cannot upload reconciliation twice for the same date."

**Why:** The user explicitly set this business rule; historical dates must not be limited to today or an arbitrary lookback period.

**How to apply:** Preserve historical-date access and enforce the one-upload-per-business-date rule in both the interface and server. Do not silently append or overwrite an existing date's uploaded reconciliation.
