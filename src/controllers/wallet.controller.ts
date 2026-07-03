import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Wallet from '../models/Wallet';
import Ledger from '../models/Ledger';
import Provider from '../models/Provider';
import * as pricingService from '../services/pricing.service';
import * as walletService from '../services/wallet.service';

export const getWalletBalance = async (req: AuthRequest, res: Response) => {
  try {
    const wallet = await walletService.getWalletBalance(req.user?.userId as string);
    if (!wallet) {
      return res.status(200).json({
        success: true,
        data: { balanceMain: 0, balanceEscrow: 0, balanceCredit: 0, balanceReferral: 0, balanceBonus: 0, currency: 'USD' }
      });
    }
    res.status(200).json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallet', error });
  }
};

export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const transactions = await walletService.getTransactionHistory(req.user?.userId as string);
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch history', error });
  }
};

import Payout from '../models/Payout';
import Statement from '../models/Statement';
import Invoice from '../models/Invoice';

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

export const getMyInvoices = async (req: AuthRequest, res: Response) => {
    try {
        const invoices = await Invoice.find({
            $or: [{ customerId: req.user?.userId }, { providerId: req.user?.userId }]
        }).sort({ createdAt: -1 });
        res.status(200).json({ success: true, data: invoices });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch invoices', error });
    }
};

export const getMyCommissionRate = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const countryCode = req.user?.countryCode;
        if (!countryCode) return res.status(400).json({ success: false, message: 'Country code missing' });

        const rate = await pricingService.getCommissionRate(countryCode, provider.tier);
        res.status(200).json({ success: true, commissionRate: rate });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch commission rate', error });
    }
};

import mongoose from 'mongoose';
import { TransactionType } from '../models/Ledger';

export const requestWithdrawal = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { amount } = req.body;
        if (!amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid amount' });
        }

        const wallet = await Wallet.findOne({ userId: req.user?.userId }).session(session);
        if (!wallet || wallet.balanceMain < amount) {
            return res.status(400).json({ success: false, message: 'Insufficient balance' });
        }

        // Deduct from balance
        wallet.balanceMain -= amount;
        await wallet.save({ session });

        // Record in Ledger
        const ledger = new Ledger({
            transactionId: `WD-${Date.now()}-${req.user?.userId.toString().slice(-4)}`,
            fromUserId: req.user?.userId,
            amount: -amount,
            currency: wallet.currency,
            countryCode: wallet.countryCode,
            type: TransactionType.PAYOUT,
            status: 'PENDING',
            metadata: { requestType: 'MANUAL_WITHDRAWAL' }
        });
        await ledger.save({ session });

        await session.commitTransaction();
        res.status(200).json({ success: true, message: 'Withdrawal request submitted successfully' });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};
