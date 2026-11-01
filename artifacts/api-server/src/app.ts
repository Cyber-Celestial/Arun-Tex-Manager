import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
// Credentialed CORS only for same-origin requests and explicitly allowed origins
// (comma-separated CORS_ALLOWED_ORIGINS). Any other origin gets no CORS headers.
const allowedOrigins = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    let allowed = !origin || allowedOrigins.has(origin);
    if (origin && !allowed) {
      try {
        allowed = new URL(origin).host === getClerkProxyHost(req);
      } catch {
        allowed = false;
      }
    }
    callback(null, { credentials: true, origin: allowed });
  }),
);
// Each save sends a whole module's data, so the default 100 KB limit is too small.
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
