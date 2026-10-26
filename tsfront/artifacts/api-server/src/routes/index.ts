import { Router, type IRouter } from "express";
import healthRouter from "./health";
import gridEvidRouter from "./grid-evid";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/grid-evid", gridEvidRouter);

export default router;
