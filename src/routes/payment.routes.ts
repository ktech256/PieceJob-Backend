import { Router } from "express";

const router = Router();

// Routes will be implemented in Phase 4/5
router.get("/config", (req, res) => {
  res.json({ success: true, message: "Payment config endpoint placeholder" });
});

export default router;
