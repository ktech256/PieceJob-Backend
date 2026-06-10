import { Router } from "express";

const router = Router();

// Routes for FCM token registration etc.
router.post("/token", (req, res) => {
  res.json({ success: true, message: "FCM token registered" });
});

export default router;
