import { Router, Request, Response } from "express";

const router = Router();

// Routes for FCM token registration etc.
router.post("/token", (req: Request, res: Response) => {
  res.json({ success: true, message: "FCM token registered" });
});

export default router;
