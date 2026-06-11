import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Wallet from '../models/Wallet';
import Ledger from '../models/Ledger';
import Provider from '../models/Provider';
import * as pricingService from '../services/pricing.service';

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

import Payout from '../models/Payout';
import Statement from '../models/Statement';

export const getMyPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const payouts = await Payout.find({ providerId: req.user?.userId }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: payouts });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payouts', error });
  }
};

export const getMyStatements = async (req: AuthRequest, res: Response) => {
  try {
    const statements = await Statement.find({ userId: req.user?.userId }).sort({ periodStart: -1 });
    res.status(200).json({ success: true, data: statements });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch statements', error });
  }
};

export const getMyCommissionRate = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const rate = await pricingService.getCommissionRate(req.user?.countryCode || 'ZA', provider.tier);
        res.status(200).json({ success: true, commissionRate: rate });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch commission rate', error });
    }
};
