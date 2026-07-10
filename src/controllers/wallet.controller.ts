import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Wallet from '../models/Wallet';
import Ledger from '../models/Ledger';
import Provider from '../models/Provider';
import Country from '../models/Country';
import * as pricingService from '../services/pricing.service';
import * as walletService from '../services/wallet.service';
import { formatToWorkspaceTime } from '../utils/date';

export const getWalletBalance = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const country = await Country.findOne({ code: countryCode });
    const tz = country?.timezone || 'UTC';

    const wallet = await walletService.getWalletBalance(req.user?.userId as string);
    if (!wallet) {
      return res.status(200).json({
        success: true,
        data: { balanceMain: 0, balanceEscrow: 0, balanceCredit: 0, balanceReferral: 0, balanceBonus: 0, currency: 'USD' }
      });
    }

    if (wallet.recentServiceFees) {
        wallet.recentServiceFees = wallet.recentServiceFees.map((f: any) => ({
            ...f,
            date: formatToWorkspaceTime(f.date, tz)
        }));
    }

    res.status(200).json({ success: true, data: wallet });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wallet', error });
  }
};

export const getTransactionHistory = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const country = await Country.findOne({ code: countryCode });
    const tz = country?.timezone || 'UTC';

    const transactions = await walletService.getTransactionHistory(req.user?.userId as string);
    const data = transactions.map((t: any) => {
        const obj = t.toObject ? t.toObject() : t;
        obj.createdAt = formatToWorkspaceTime(obj.createdAt, tz);
        return obj;
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch history', error });
  }
};

import Payout from '../models/Payout';
import Statement from '../models/Statement';
import Invoice from '../models/Invoice';

export const getMyPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const country = await Country.findOne({ code: countryCode });
    const tz = country?.timezone || 'UTC';

    const payouts = await Payout.find({ providerId: req.user?.userId }).sort({ createdAt: -1 });
    const data = payouts.map(p => {
        const obj = p.toObject() as any;
        obj.createdAt = formatToWorkspaceTime(obj.createdAt, tz);
        return obj;
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch payouts', error });
  }
};

export const getMyStatements = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const country = await Country.findOne({ code: countryCode });
    const tz = country?.timezone || 'UTC';

    const statements = await Statement.find({ userId: req.user?.userId }).sort({ periodStart: -1 });
    const data = statements.map(s => {
        const obj = s.toObject() as any;
        obj.periodStart = formatToWorkspaceTime(obj.periodStart, tz);
        obj.periodEnd = formatToWorkspaceTime(obj.periodEnd, tz);
        obj.createdAt = formatToWorkspaceTime(obj.createdAt, tz);
        return obj;
    });
    res.status(200).json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch statements', error });
  }
};

export const getMyInvoices = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const country = await Country.findOne({ code: countryCode });
        const tz = country?.timezone || 'UTC';

        const invoices = await Invoice.find({
            $or: [{ customerId: req.user?.userId }, { providerId: req.user?.userId }]
        }).sort({ createdAt: -1 });

        const data = invoices.map(i => {
            const obj = i.toObject() as any;
            obj.createdAt = formatToWorkspaceTime(obj.createdAt, tz);
            return obj;
        });
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch invoices', error });
    }
};

export const getMyServiceFeeRate = async (req: AuthRequest, res: Response) => {
    try {
        const provider = await Provider.findOne({ userId: req.user?.userId });
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const countryCode = req.user?.countryCode;
        if (!countryCode) return res.status(400).json({ success: false, message: 'Country code missing' });

        const rate = await pricingService.getServiceFeeRate(countryCode, provider.tier);
        res.status(200).json({ success: true, serviceFeeRate: rate });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch service fee rate', error });
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

import * as voucherService from '../services/voucher.service';
import SystemSettings from '../models/SystemSettings';
import UsedVoucher from '../models/UsedVoucher';
import CommissionRecord from '../models/ServiceFeeRecord';
import * as auditService from '../services/audit.service';

export const payServiceFee = async (req: AuthRequest, res: Response) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const { vendor, voucherNumber, amount } = req.body;
        const providerId = req.user?.userId;
        const countryCode = req.user?.countryCode;

        let paymentAmount = 0;

        if (vendor === 'CREDIT') {
            const wallet = await Wallet.findOne({ userId: providerId }).session(session);
            if (!wallet) throw new Error('Wallet not found');

            const debt = Math.abs(Math.min(0, wallet.serviceFeeBalance));
            if (debt <= 0) {
                return res.status(400).json({ success: false, message: 'No outstanding service fee to pay' });
            }

            const maxPayable = Math.min(wallet.balanceCredit, debt);
            paymentAmount = amount || maxPayable;

            if (paymentAmount <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid payment amount' });
            }

            if (paymentAmount > wallet.balanceCredit) {
                return res.status(400).json({ success: false, message: 'Insufficient credit balance' });
            }

            if (paymentAmount > debt + 0.01) {
                return res.status(400).json({ success: false, message: 'Payment amount exceeds outstanding service fee' });
            }

            // Deduct from Credit Balance
            wallet.balanceCredit -= paymentAmount;

            // Record Ledger entry for the Credit Deduction
            await new Ledger({
                transactionId: `SF-CR-${Date.now()}`,
                fromUserId: providerId,
                amount: paymentAmount,
                currency: wallet.currency,
                countryCode: wallet.countryCode,
                type: TransactionType.SERVICE_FEE,
                status: 'COMPLETED',
                description: `Service Fee Payment from Credit Balance`,
                metadata: {
                    balanceAffected: 'balanceCredit',
                    previousBalance: wallet.balanceCredit + paymentAmount,
                    newBalance: wallet.balanceCredit
                }
            }).save({ session });

        } else {
            if (!vendor || !voucherNumber) {
                return res.status(400).json({ success: false, message: 'Vendor and voucher number required' });
            }

            const alreadyUsed = await UsedVoucher.findOne({ voucherNumber, vendor }).session(session);
            if (alreadyUsed) {
                return res.status(400).json({ success: false, message: 'This voucher has already been redeemed' });
            }

            const verification = await voucherService.validateVoucher(vendor, voucherNumber, countryCode as string);
            if (!verification.isValid) {
                return res.status(400).json({ success: false, message: 'Invalid or expired voucher' });
            }

            // If user provided an amount, ensure it matches the voucher's value (within tolerance)
            if (amount && Math.abs(amount - verification.amount) > 0.01) {
                 return res.status(400).json({
                     success: false,
                     message: `Voucher value mismatch. Entered: ${amount}, Actual: ${verification.amount}`
                 });
            }

            paymentAmount = verification.amount;

            // Mark Voucher as Used
            await new UsedVoucher({
                voucherNumber,
                vendor,
                amount: paymentAmount,
                countryCode: countryCode as string,
                redeemedBy: providerId,
                ledgerReference: `VCH-${vendor}-${Date.now()}`
            }).save({ session });
        }

        const wallet = await Wallet.findOne({ userId: providerId }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        // Logic Change: serviceFeeBalance is negative for debt, positive for credit
        wallet.serviceFeeBalance += paymentAmount;

        // Record Timeline in all associated outstanding ServiceFeeRecords
        const serviceFeeRecords = await CommissionRecord.find({
            providerId,
            status: { $in: ['OUTSTANDING', 'PARTIAL'] }
        }).sort({ createdAt: 1 }).session(session);

        let remainingPayment = paymentAmount;
        for (const record of serviceFeeRecords) {
            if (remainingPayment <= 0) break;
            const toPay = Math.min(record.outstandingBalance, remainingPayment);
            record.outstandingBalance -= toPay;
            remainingPayment -= toPay;
            record.status = record.outstandingBalance <= 0 ? 'PAID' : 'PARTIAL';
            record.timeline.push({
                event: vendor === 'CREDIT' ? 'CREDIT_PAYMENT_REDEEMED' : 'VOUCHER_PAYMENT_REDEEMED',
                timestamp: new Date(),
                metadata: { vendor, amount: toPay, voucherNumber: vendor === 'CREDIT' ? 'INTERNAL' : voucherNumber }
            });
            await record.save({ session });
        }

        // Automatic Unsuspension
        const settings = await SystemSettings.findOne({ countryCode }).session(session) || await SystemSettings.findOne({ countryCode: 'GLOBAL' }).session(session);
        if (settings?.autoUnsuspendEnabled && wallet.isSuspended) {
            const threshold = settings?.serviceFeeSuspensionThreshold || 100;
            if (wallet.serviceFeeBalance >= -threshold) {
                wallet.status = 'ACTIVE';
                wallet.isSuspended = false;
                wallet.suspendReason = undefined;
            }
        }

        await wallet.save({ session });

        // Record in Ledger for the Service Fee Credit
        const ledger = await new Ledger({
            transactionId: vendor === 'CREDIT' ? `SF-PAY-${Date.now()}` : `VCH-${vendor}-${Date.now()}`,
            toUserId: providerId,
            amount: paymentAmount,
            currency: wallet.currency,
            countryCode: wallet.countryCode,
            type: vendor === 'CREDIT' ? TransactionType.SERVICE_FEE : TransactionType.CREDIT_TOPUP,
            status: 'COMPLETED',
            description: vendor === 'CREDIT' ? `Service Fee Payment from Credit` : `Voucher Payment: ${vendor}`,
            metadata: {
                vendor,
                voucherNumber: vendor === 'CREDIT' ? 'N/A' : voucherNumber,
                previousServiceFeeBalance: wallet.serviceFeeBalance - paymentAmount,
                currentServiceFeeBalance: wallet.serviceFeeBalance
            }
        }).save({ session });

        await auditService.logAdminAction({
            countryCode: wallet.countryCode,
            adminId: 'SYSTEM',
            adminRole: 'SYSTEM',
            action: 'SERVICE_FEE_PAYMENT',
            entityType: 'Wallet',
            entityId: wallet._id.toString(),
            afterState: { serviceFeeBalance: wallet.serviceFeeBalance, balanceMain: wallet.balanceMain, balanceCredit: wallet.balanceCredit },
            ipAddress: req.ip,
            systemSource: 'MOBILE_APP'
        });

        await session.commitTransaction();
        res.status(200).json({
            success: true,
            message: 'Service fee paid successfully',
            data: {
                paymentAmount,
                serviceFeeBalance: wallet.serviceFeeBalance,
                balanceMain: wallet.balanceMain,
                isSuspended: wallet.isSuspended
            }
        });
    } catch (error: any) {
        await session.abortTransaction();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        session.endSession();
    }
};

