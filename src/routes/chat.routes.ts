import { Router } from "express";
import * as chatController from "../controllers/chat.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

router.get("/conversations", authenticate, chatController.getConversations);
router.get("/:jobId", authenticate, chatController.getJobMessages);
router.post("/", authenticate, chatController.sendMessage);

export default router;
