import { Router, type IRouter } from "express";
import healthRouter from "./health";
import workspaceRouter from "./workspace";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(workspaceRouter);
router.use(storageRouter);

export default router;
