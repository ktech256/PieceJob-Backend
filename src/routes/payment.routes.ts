import { Router, Response } from "express";
import * as paymentAdminController from "../controllers/admin/payment.controller";
import { authenticate, AuthRequest } from "../middleware/auth.middleware";
import * as settingsService from "../services/settings.service";
import Country from "../models/Country";

import * as paymentController from "../controllers/payment.controller";

const router = Router();

router.get("/config", authenticate, async (req: AuthRequest, res: Response) => {
  const countryCode = req.user?.countryCode || 'GLOBAL';
  const country = await Country.findOne({ code: countryCode });
  res.json({ success: true, config: { gateway: 'PAYSTACK', currency: country?.currency || 'USD' } });
});

router.get("/verify/:reference", paymentController.verifyPayment);
router.post("/paystack/webhook", paymentController.handlePaystackWebhook);
router.patch("/job/:jobId/mark-paid", authenticate, paymentAdminController.markJobPaid);

export default router;
