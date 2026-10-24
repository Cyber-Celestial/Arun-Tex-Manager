import { clerkClient, getAuth } from "@clerk/express";
import {
  GetWorkspaceMeResponse,
  GetWorkspaceStateResponse,
  ListWorkspaceUsersResponse,
  UpdateAttendanceStateBody,
  UpdateAttendanceStateResponse,
  UpdateB2cStateBody,
  UpdateB2cStateResponse,
  UpdateDispatchStateBody,
  UpdateDispatchStateResponse,
  UpdateHrStateBody,
  UpdateHrStateResponse,
  UpdateWorkspaceUserRoleBody,
  UpdateWorkspaceUserRoleParams,
  UpdateWorkspaceUserRoleResponse,
} from "@workspace/api-zod";
import {
  db,
  operationsStateTable,
  workspaceUsersTable,
  type WorkspaceRole,
  type WorkspaceUser,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

type ModuleName = "b2c" | "dispatch" | "hr" | "attendance";
type JsonObject = Record<string, unknown>;

const INITIAL_STATE = {
  b2c: { batches: [] },
  dispatch: { invoices: [] },
  hr: {
    employees: [],
    attendance: [],
    noteAdvances: [],
    salaryAdvances: [],
    sundayRosters: [],
    diwaliFullDay: false,
  },
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSessionUserId(req: Request): string | null {
  return getAuth(req).userId ?? null;
}

async function requireWorkspaceUser(
  req: Request,
  res: Response,
): Promise<WorkspaceUser | null> {
  const userId = getSessionUserId(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to access The Arun Tex workspace." });
    return null;
  }

  const [knownUser] = await db
    .select()
    .from(workspaceUsersTable)
    .where(eq(workspaceUsersTable.userId, userId))
    .limit(1);
  if (knownUser) return knownUser;

  const profile = await clerkClient.users.getUser(userId);
  const name =
    profile.fullName ||
    profile.username ||
    [profile.firstName, profile.lastName].filter(Boolean).join(" ") ||
    "Team member";
  const email =
    profile.primaryEmailAddress?.emailAddress ||
    profile.emailAddresses[0]?.emailAddress ||
    `${userId}@clerk.invalid`;

  const member = await db.transaction(async (tx) => {
    await tx
      .insert(operationsStateTable)
      .values({ id: "main" })
      .onConflictDoNothing();

    // Serializing first sign-ins makes the one-time Admin bootstrap safe
    // when two new accounts arrive at the same time.
    await tx
      .select({ id: operationsStateTable.id })
      .from(operationsStateTable)
      .where(eq(operationsStateTable.id, "main"))
      .for("update");

    const [existing] = await tx
      .select()
      .from(workspaceUsersTable)
      .where(eq(workspaceUsersTable.userId, userId))
      .limit(1);

    if (existing) {
      const [updated] = await tx
        .update(workspaceUsersTable)
        .set({ name, email })
        .where(eq(workspaceUsersTable.userId, userId))
        .returning();
      return updated;
    }

    const [firstAdmin] = await tx
      .select({ userId: workspaceUsersTable.userId })
      .from(workspaceUsersTable)
      .where(eq(workspaceUsersTable.role, "admin"))
      .limit(1);
    const [created] = await tx
      .insert(workspaceUsersTable)
      .values({
        userId,
        name,
        email,
        role: firstAdmin ? "pending" : "admin",
      })
      .returning();
    return created;
  });

  return member;
}

async function ensureStateRow(): Promise<void> {
  await db
    .insert(operationsStateTable)
    .values({ id: "main", ...INITIAL_STATE })
    .onConflictDoNothing();
}

function cashDenominationTotal(denominations: unknown): number {
  if (!isObject(denominations)) return 0;
  const notes = [500, 200, 100, 50, 20, 10, 5, 2, 1];
  return notes.reduce((sum, value) => {
    const count = Number(denominations[String(value)] ?? 0);
    return sum + (Number.isFinite(count) && count > 0 ? value * count : 0);
  }, 0);
}

function classifyBankMode(row: JsonObject): "UPI" | "CARD" | null {
  const mode = String(row.mode ?? "").toUpperCase();
  if (mode.includes("UPI")) return "UPI";
  if (mode.includes("CARD")) return "CARD";
  const narration = String(row.narration ?? "").toUpperCase();
  if (narration.includes("UPI") || narration.includes("@")) return "UPI";
  if (["POS", "SWIPE", "MERCHANT", "SETTLEMENT"].some((word) => narration.includes(word))) {
    return "CARD";
  }
  return null;
}

function matchOnlinePayments(data: JsonObject, role: WorkspaceRole): void {
  if (!Array.isArray(data.batches)) return;
  for (const batchValue of data.batches) {
    if (!isObject(batchValue) || !Array.isArray(batchValue.transactions)) continue;
    const batch = batchValue;
    const transactions = batch.transactions as unknown[];
    const bankRows = Array.isArray(batch.bankRows)
      ? batch.bankRows.filter(isObject)
      : [];
    const allocated = new Set<JsonObject>();

    for (const transactionValue of transactions) {
      if (!isObject(transactionValue) || transactionValue.type === "Return") continue;
      const transaction = transactionValue;
      const invoiceNumber = String(transaction.invoiceNumber ?? "");
      const expected = [
        { mode: "UPI" as const, amount: Number(transaction.upiAmount ?? 0) },
        { mode: "CARD" as const, amount: Number(transaction.cardAmount ?? 0) },
      ].filter((part) => part.amount > 0);

      if (expected.length === 0) continue;

      const matches: Array<{ mode: "UPI" | "CARD"; reference: string; amount: number }> = [];
      for (const part of expected) {
        const bankRow = bankRows.find((row) => {
          if (allocated.has(row) || classifyBankMode(row) !== part.mode) return false;
          const date = String(row.date ?? "").slice(0, 10);
          const transactionDate = String(transaction.date ?? "").slice(0, 10);
          const deposit = Number(row.depositAmount);
          return (
            date === transactionDate &&
            Number.isFinite(deposit) &&
            Math.round(deposit * 100) === Math.round(part.amount * 100)
          );
        });
        if (!bankRow) continue;
        allocated.add(bankRow);
        const reference = String(bankRow.reference ?? bankRow.bankTransactionId ?? "");
        matches.push({ mode: part.mode, reference, amount: part.amount });
        bankRow.matchedInvoiceNumber = invoiceNumber;
        bankRow.matchedMode = part.mode;
      }

      const fullyMatched = matches.length === expected.length;
      const override = role === "admin" && transaction.adminOverride === true;
      transaction.bankMatches = matches;
      transaction.bankVerified = fullyMatched || override;
      transaction.bankTransactionId =
        matches.length === 1 ? matches[0].reference : null;
      transaction.bankVerificationStatus = fullyMatched
        ? "Matched"
        : override
          ? "Admin override"
          : "Missing bank entry";
    }
  }
}

function validateB2cState(data: JsonObject): string | null {
  if (!Array.isArray(data.batches)) return "B2C data must contain a batches list.";

  for (const batchValue of data.batches) {
    if (!isObject(batchValue)) return "A B2C batch is not valid.";
    const batch = batchValue;
    if (!Array.isArray(batch.transactions)) {
      return "Each B2C batch must contain a transactions list.";
    }
    let cashSales = 0;
    let returns = 0;
    for (const transactionValue of batch.transactions) {
      if (!isObject(transactionValue)) return "A transaction is not valid.";
      const transaction = transactionValue;
      const amount = Number(transaction.totalInvoiceAmount);
      if (!Number.isFinite(amount) || amount < 0) {
        return "Invoice amounts must be valid, non-negative numbers.";
      }
      if (transaction.type === "Return") {
        returns += amount;
        continue;
      }
      const cash = Number(transaction.cashAmount ?? 0);
      const upi = Number(transaction.upiAmount ?? 0);
      const card = Number(transaction.cardAmount ?? 0);
      if (![cash, upi, card].every((part) => Number.isFinite(part) && part >= 0)) {
        return "Payment amounts must be valid, non-negative numbers.";
      }
      if (
        transaction.paymentMode === "SPLIT" &&
        Math.round((cash + upi + card) * 100) !== Math.round(amount * 100)
      ) {
        return `Split payment for ${String(transaction.invoiceNumber ?? "an invoice")} does not equal its invoice amount.`;
      }
      if (
        transaction.paymentMode === "CASH" &&
        Math.round(cash * 100) !== Math.round(amount * 100)
      ) {
        return "Cash payments must equal the invoice amount.";
      }
      if (
        transaction.paymentMode === "UPI" &&
        Math.round(upi * 100) !== Math.round(amount * 100)
      ) {
        return "UPI payments must equal the invoice amount.";
      }
      if (
        transaction.paymentMode === "CARD" &&
        Math.round(card * 100) !== Math.round(amount * 100)
      ) {
        return "Card payments must equal the invoice amount.";
      }
      cashSales += cash;
    }

    if (batch.status === "Submitted") {
      const onlineMissing = batch.transactions.some((item) => {
        if (!isObject(item) || item.type === "Return") return false;
        return (
          (Number(item.upiAmount ?? 0) > 0 ||
            Number(item.cardAmount ?? 0) > 0) &&
          item.bankVerified !== true
        );
      });
      if (onlineMissing) {
        return "Online payments must be bank-verified before the day is submitted.";
      }
      const expectedCash = Math.round((cashSales - returns) * 100);
      const enteredCash = Math.round(cashDenominationTotal(batch.denominations) * 100);
      if (expectedCash !== enteredCash) {
        return "Cash denominations must exactly match cash sales less returns.";
      }
    }
  }

  return null;
}

function validateDispatchState(data: JsonObject): string | null {
  if (!Array.isArray(data.invoices)) {
    return "Dispatch data must contain an invoices list.";
  }
  for (const value of data.invoices) {
    if (!isObject(value)) return "A dispatch invoice is not valid.";
    if (value.status !== "Completed") continue;
    const ready =
      value.eInvoiceDone === true &&
      value.eWayDone === true &&
      value.bundleDone === true &&
      typeof value.lrNumber === "string" &&
      value.lrNumber.trim().length > 0 &&
      typeof value.lrPdfObjectPath === "string" &&
      value.lrPdfObjectPath.length > 0 &&
      value.whatsappSent === true &&
      value.courierSent === true &&
      value.vastraCourierUpdated === true &&
      typeof value.courierPdfObjectPath === "string" &&
      value.courierPdfObjectPath.length > 0;
    if (!ready) {
      return "A dispatch invoice cannot be completed until every compliance step is done.";
    }
  }
  return null;
}

function validateHrState(data: JsonObject): string | null {
  if (!Array.isArray(data.employees)) {
    return "HR data must contain an employees list.";
  }
  if (!Array.isArray(data.attendance)) {
    return "HR data must contain an attendance list.";
  }
  if (!Array.isArray(data.noteAdvances) || !Array.isArray(data.salaryAdvances)) {
    return "HR data must contain both advance lists.";
  }
  for (const advanceValue of data.noteAdvances) {
    if (!isObject(advanceValue)) return "A note advance is not valid.";
    const balance = Number(advanceValue.remainingBalance);
    const repayment = Number(advanceValue.monthlyRepayment);
    if (
      !Number.isFinite(balance) ||
      !Number.isFinite(repayment) ||
      balance < 0 ||
      repayment <= 0
    ) {
      return "Note advance balances and monthly repayments must be valid.";
    }
  }
  return null;
}

function applyRoleProjection(
  role: WorkspaceRole,
  state: typeof operationsStateTable.$inferSelect,
  user: WorkspaceUser,
) {
  const b2c = state.b2c as JsonObject;
  const dispatch = state.dispatch as JsonObject;
  const hr = state.hr as JsonObject;

  if (role === "accounts") {
    const batches = Array.isArray(b2c.batches) ? b2c.batches : [];
    return {
      version: state.version,
      user,
      b2c: {
        batches: batches
          .filter((batch) => isObject(batch) && batch.status === "Submitted")
          .map((batch) => {
            const record = batch as JsonObject;
            return {
              date: record.date,
              status: record.status,
              tallyExport: record.tallyExport,
            };
          }),
      },
      dispatch: { invoices: [] },
      hr,
    };
  }

  if (role === "billing") {
    return {
      version: state.version,
      user,
      b2c,
      dispatch,
      hr: {
        employees: [],
        attendance: [],
        noteAdvances: [],
        salaryAdvances: [],
        sundayRosters: [],
        diwaliFullDay: false,
      },
    };
  }

  return {
    version: state.version,
    user,
    b2c,
    dispatch,
    hr,
  };
}

function activeRole(role: WorkspaceRole): boolean {
  return role !== "pending";
}

async function writeModule(
  req: Request,
  res: Response,
  module: ModuleName,
  bodySchema:
    | typeof UpdateB2cStateBody
    | typeof UpdateDispatchStateBody
    | typeof UpdateHrStateBody
    | typeof UpdateAttendanceStateBody,
  responseSchema:
    | typeof UpdateB2cStateResponse
    | typeof UpdateDispatchStateResponse
    | typeof UpdateHrStateResponse
    | typeof UpdateAttendanceStateResponse,
): Promise<void> {
  const user = await requireWorkspaceUser(req, res);
  if (!user) return;
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The submitted workspace data is not valid." });
    return;
  }

  if (!activeRole(user.role)) {
    res.status(403).json({ error: "An Admin must assign your workspace role." });
    return;
  }
  if (module === "b2c" || module === "dispatch") {
    if (user.role !== "admin" && user.role !== "billing") {
      res.status(403).json({ error: "Billing or Admin access is required." });
      return;
    }
  } else if (module === "hr" && user.role !== "admin") {
    res.status(403).json({ error: "Admin access is required to edit HR master data." });
    return;
  } else if (
    module === "attendance" &&
    user.role !== "admin" &&
    user.role !== "accounts"
  ) {
    res.status(403).json({ error: "Accounts or Admin access is required." });
    return;
  }

  const requestData = parsed.data;
  if (!isObject(requestData.data)) {
    res.status(400).json({ error: "Workspace data must be an object." });
    return;
  }
  const data = requestData.data;

  if (module === "b2c") {
    matchOnlinePayments(data, user.role);
    const error = validateB2cState(data);
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }
  if (module === "dispatch") {
    const error = validateDispatchState(data);
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }
  if (module === "hr") {
    const error = validateHrState(data);
    if (error) {
      res.status(400).json({ error });
      return;
    }
  }
  if (module === "attendance" && !Array.isArray(data.attendance)) {
    res.status(400).json({ error: "Attendance data must contain an exceptions list." });
    return;
  }

  await ensureStateRow();
  const whereVersion = and(
    eq(operationsStateTable.id, "main"),
    eq(operationsStateTable.version, requestData.expectedVersion),
  );
  const updated =
    module === "attendance"
      ? await db
          .update(operationsStateTable)
          .set({
            hr: sql`jsonb_set(${operationsStateTable.hr}, '{attendance}', ${JSON.stringify(data.attendance)}::jsonb, true)`,
            version: sql`${operationsStateTable.version} + 1`,
          })
          .where(whereVersion)
          .returning({ version: operationsStateTable.version })
      : module === "b2c"
        ? await db
            .update(operationsStateTable)
            .set({
              b2c: data,
              version: sql`${operationsStateTable.version} + 1`,
            })
            .where(whereVersion)
            .returning({ version: operationsStateTable.version })
        : module === "dispatch"
          ? await db
              .update(operationsStateTable)
              .set({
                dispatch: data,
                version: sql`${operationsStateTable.version} + 1`,
              })
              .where(whereVersion)
              .returning({ version: operationsStateTable.version })
          : await db
              .update(operationsStateTable)
              .set({
                hr: data,
                version: sql`${operationsStateTable.version} + 1`,
              })
              .where(whereVersion)
              .returning({ version: operationsStateTable.version });

  if (!updated[0]) {
    res.status(409).json({
      error: "The workspace changed in another session. Refresh and try again.",
    });
    return;
  }

  res.json(responseSchema.parse({ version: updated[0].version, data }));
}

router.get("/workspace/me", async (req, res): Promise<void> => {
  const user = await requireWorkspaceUser(req, res);
  if (!user) return;
  res.json(GetWorkspaceMeResponse.parse(user));
});

router.get("/workspace/state", async (req, res): Promise<void> => {
  const user = await requireWorkspaceUser(req, res);
  if (!user) return;
  if (!activeRole(user.role)) {
    res.status(403).json({ error: "An Admin must assign your workspace role." });
    return;
  }
  await ensureStateRow();
  const [state] = await db
    .select()
    .from(operationsStateTable)
    .where(eq(operationsStateTable.id, "main"))
    .limit(1);
  res.json(GetWorkspaceStateResponse.parse(applyRoleProjection(user.role, state, user)));
});

router.put("/workspace/data/b2c", async (req, res): Promise<void> => {
  await writeModule(
    req,
    res,
    "b2c",
    UpdateB2cStateBody,
    UpdateB2cStateResponse,
  );
});

router.put("/workspace/data/dispatch", async (req, res): Promise<void> => {
  await writeModule(
    req,
    res,
    "dispatch",
    UpdateDispatchStateBody,
    UpdateDispatchStateResponse,
  );
});

router.put("/workspace/data/hr", async (req, res): Promise<void> => {
  await writeModule(req, res, "hr", UpdateHrStateBody, UpdateHrStateResponse);
});

router.put("/workspace/data/hr/attendance", async (req, res): Promise<void> => {
  await writeModule(
    req,
    res,
    "attendance",
    UpdateAttendanceStateBody,
    UpdateAttendanceStateResponse,
  );
});

router.get("/workspace/users", async (req, res): Promise<void> => {
  const user = await requireWorkspaceUser(req, res);
  if (!user) return;
  if (user.role !== "admin") {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }
  const users = await db
    .select()
    .from(workspaceUsersTable)
    .orderBy(workspaceUsersTable.createdAt);
  res.json(ListWorkspaceUsersResponse.parse(users));
});

router.patch("/workspace/users/:userId", async (req, res): Promise<void> => {
  const admin = await requireWorkspaceUser(req, res);
  if (!admin) return;
  if (admin.role !== "admin") {
    res.status(403).json({ error: "Admin access is required." });
    return;
  }
  const params = UpdateWorkspaceUserRoleParams.safeParse(req.params);
  const body = UpdateWorkspaceUserRoleBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "The user or role is not valid." });
    return;
  }

  if (
    params.data.userId === admin.userId &&
    body.data.role !== "admin"
  ) {
    const [otherAdmin] = await db
      .select({ userId: workspaceUsersTable.userId })
      .from(workspaceUsersTable)
      .where(eq(workspaceUsersTable.role, "admin"))
      .limit(2);
    if (!otherAdmin || otherAdmin.userId === admin.userId) {
      res.status(400).json({ error: "The workspace must keep at least one Admin." });
      return;
    }
  }

  const [updated] = await db
    .update(workspaceUsersTable)
    .set({ role: body.data.role })
    .where(eq(workspaceUsersTable.userId, params.data.userId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Workspace user not found." });
    return;
  }
  res.json(UpdateWorkspaceUserRoleResponse.parse(updated));
});

export default router;
