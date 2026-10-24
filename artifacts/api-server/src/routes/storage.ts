import { getAuth } from "@clerk/express";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, workspaceUsersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { Readable } from "stream";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const maxPdfBytes = 25 * 1024 * 1024;

async function hasDispatchAccess(userId: string): Promise<boolean> {
  const [user] = await db
    .select({ role: workspaceUsersTable.role })
    .from(workspaceUsersTable)
    .where(eq(workspaceUsersTable.userId, userId))
    .limit(1);
  return user?.role === "admin" || user?.role === "billing";
}

router.post("/storage/uploads/request-url", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId || !(await hasDispatchAccess(auth.userId))) {
    res.status(auth.userId ? 403 : 401).json({ error: "Dispatch access is required." });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "File name, size, and type are required." });
    return;
  }
  const { name, size, contentType } = parsed.data;
  if (
    contentType !== "application/pdf" ||
    !name.toLowerCase().endsWith(".pdf") ||
    size > maxPdfBytes
  ) {
    res.status(400).json({ error: "Upload a PDF file no larger than 25 MB." });
    return;
  }

  try {
    const uploadURL = await storage.getObjectEntityUploadURL();
    const objectPath = storage.normalizeObjectEntityPath(uploadURL);
    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        name,
        size,
        contentType,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Could not create a dispatch document upload URL");
    res.status(500).json({ error: "Could not prepare the file upload." });
  }
});

router.get("/storage/objects/*path", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId || !(await hasDispatchAccess(auth.userId))) {
    res.status(auth.userId ? 403 : 401).json({ error: "Dispatch access is required." });
    return;
  }

  const rawPath = req.params.path;
  const path = Array.isArray(rawPath) ? rawPath.join("/") : rawPath;
  if (!/^uploads\/[a-f0-9-]{36}$/i.test(path)) {
    res.status(404).json({ error: "Document not found." });
    return;
  }

  try {
    const file = await storage.getObjectEntityFile(`/objects/${path}`);
    const response = await storage.downloadObject(file, 60);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Document not found." });
      return;
    }
    req.log.error({ err: error }, "Could not read a dispatch document");
    res.status(500).json({ error: "Could not open the document." });
  }
});

export default router;
