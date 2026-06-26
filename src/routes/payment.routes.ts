import { Router, Response } from "express";
import * as paymentAdminController from "../controllers/admin/payment.controller";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";
import * as settingsService from "../services/settings.service";

import * as paymentController from "../controllers/payment.controller";

const router = Router();

router.get("/config", authenticate, async (req: AuthRequest, res: Response) => {
  const settings = await settingsService.getSettings(req.user?.countryCode);
  res.json({ success: true, config: { gateway: 'PAYSTACK', currency: settings.currency || 'USD' } });
});

router.get("/verify/:reference", paymentController.verifyPayment);
router.post("/paystack/webhook", paymentController.handlePaystackWebhook);
router.patch("/job/:jobId/mark-paid", authenticate, paymentAdminController.markJobPaid);

export default router;
