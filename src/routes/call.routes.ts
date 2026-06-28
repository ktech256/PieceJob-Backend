import { Router } from "express";
import * as callController from "../controllers/call.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.post("/init", authenticate, callController.logCallInitiation);
router.patch("/:callId/status", authenticate, callController.updateCallStatus);
router.get("/history/:jobId", authenticate, callController.getJobCallHistory);

export default router;
