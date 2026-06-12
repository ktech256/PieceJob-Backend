import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { UserRole } from "../models/User";

const router = Router();

router.get("/", authenticate, notificationController.getMyNotifications);
router.patch("/:id/read", authenticate, notificationController.markAsRead);

// Admin
router.get("/logs", authenticate, authorize([UserRole.SUPER_ADMIN, UserRole.COUNTRY_ADMIN]), notificationController.getDeliveryLogs);

export default router;
