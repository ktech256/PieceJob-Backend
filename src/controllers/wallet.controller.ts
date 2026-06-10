import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Wallet from '../models/Wallet';
import Ledger from '../models/Ledger';

export const getWalletBalance = async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user?.userId });
    if (!wallet) {
      return res.status(200).json({
        success: true,
        wallet: { balanceMain: 0, balanceEscrow: 0, balanceCredit: 0, balanceReferral: 0 }
      });
    }
    res.status(200).json({ success: true, wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallet', error });
  }
};

export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const transactions = await Ledger.find({
      $or: [{ fromUserId: req.user?.userId }, { toUserId: req.user?.userId }]
    }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch history', error });
  }
};
