---
name: Regression data isolation
description: Why signed-in dispatch regression tests must isolate the whole workspace, not just record names.
---

Run destructive or full-module browser regression writes against an isolated workspace database namespace, with synthetic authentication accounts and a separate private document prefix. Do not snapshot and restore the staff workspace around tests.

**Why:** Dispatch saves replace a shared module, rather than inserting a record owned by the signed-in user. A unique account or invoice number does not prevent a test from overwriting staff changes, and restoring a snapshot can discard concurrent work.

**How to apply:** Preserve full-workspace isolation when extending browser tests. Keep real authentication, validation and private storage behavior under test; avoid production auth bypasses. Clean test accounts, private objects and the isolated database namespace on both success and failure, and report cleanup failures explicitly.
