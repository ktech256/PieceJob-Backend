import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Wallet from '../models/Wallet';
import Ledger from '../models/Ledger';
import Provider from '../models/Provider';
import User from '../models/User';
import Country from '../models/Country';
import * as pricingService from '../services/pricing.service';
import * as walletService from '../services/wallet.service';
import * as financialService from '../services/financial.service';
import * as notificationQueue from '../services/notification.queue';
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

        // Dispatch Withdrawal Requested Email
        const user = await User.findById(req.user?.userId).session(session);
        if (user?.email) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email: user.email,
                templateCode: 'WITHDRAWAL_REQUESTED',
                templateData: {
                    firstName: user.firstName,
                    amount: amount.toString(),
                    currency: wallet.currency
                },
                countryCode: wallet.countryCode
            });
        }

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

        const wallet = await Wallet.findOne({ userId: providerId }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        if (vendor === 'CREDIT') {
            // "Pay with Credit" logic:
            // In the new Running Account model, if balanceCredit is positive, it means PieceJob owes the provider.
            // Settling records using this positive balance.

            const currentNetPosition = wallet.balanceCredit;
            if (currentNetPosition <= 0) {
                return res.status(400).json({ success: false, message: 'No positive credit available to apply' });
            }

            // Calculate total outstanding in records
            const serviceFeeRecords = await CommissionRecord.find({
                providerId,
                status: { $in: ['OUTSTANDING', 'PARTIAL'] }
            }).session(session);

            const totalDebtInRecords = serviceFeeRecords.reduce((acc, r) => acc + r.outstandingBalance, 0);
            if (totalDebtInRecords <= 0) {
                 return res.status(400).json({ success: false, message: 'No outstanding service fee records to settle' });
            }

            paymentAmount = amount || Math.min(currentNetPosition, totalDebtInRecords);

            if (paymentAmount <= 0) {
                return res.status(400).json({ success: false, message: 'Invalid payment amount' });
            }
            if (paymentAmount > currentNetPosition + 0.01) {
                return res.status(400).json({ success: false, message: 'Insufficient positive credit' });
            }

            // Deduct from the positive credit (settling debt)
            wallet.balanceCredit -= paymentAmount;

            // Record Ledger entry for the Credit Consumption
            await new Ledger({
                transactionId: `SF-CR-${Date.now()}`,
                fromUserId: providerId,
                amount: paymentAmount,
                currency: wallet.currency,
                countryCode: wallet.countryCode,
                type: TransactionType.SERVICE_FEE,
                status: 'COMPLETED',
                description: `Service Fee Settled from Credit Balance`,
                metadata: {
                    balanceAffected: 'balanceCredit',
                    previousBalance: wallet.balanceCredit + paymentAmount,
                    newBalance: wallet.balanceCredit,
                    action: 'INTERNAL_SETTLEMENT'
                }
            }).save({ session });

        } else {
            // External Voucher/Payment
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

            if (amount && Math.abs(amount - verification.amount) > 0.01) {
                 return res.status(400).json({
                     success: false,
                     message: `Voucher value mismatch. Entered: ${amount}, Actual: ${verification.amount}`
                 });
            }

            paymentAmount = verification.amount;

            // Add to running account
            wallet.balanceCredit += paymentAmount;

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

        // Legacy sync: serviceFeeBalance tracks debt only (always <= 0)
        wallet.serviceFeeBalance = Math.min(0, wallet.balanceCredit);

        // Record Timeline in all associated outstanding ServiceFeeRecords (Automatic Reconciliation)
        // This ensures that Voucher payments or Internal Credit settlements immediately reduce outstanding job debts.
        await financialService.reconcileProviderCredit(providerId as string, paymentAmount, session, {
            source: vendor === 'CREDIT' ? 'INTERNAL_CREDIT' : 'VOUCHER_PAYMENT',
            description: vendor === 'CREDIT' ? 'Internal Credit applied to Outstanding Fees' : `Voucher Payment (${vendor}) applied to Outstanding Fees`,
            vendor,
            voucherNumber,
            currency: wallet.currency,
            countryCode: wallet.countryCode
        });

        await wallet.save({ session });

        // Record in Ledger for the Credit toward Running Account
        if (vendor !== 'CREDIT') {
            await new Ledger({
                transactionId: `VCH-${vendor}-${Date.now()}`,
                toUserId: providerId,
                amount: paymentAmount,
                currency: wallet.currency,
                countryCode: wallet.countryCode,
                type: TransactionType.CREDIT_TOPUP,
                status: 'COMPLETED',
                description: `Voucher Payment: ${vendor}`,
                metadata: {
                    vendor,
                    voucherNumber,
                    previousBalance: wallet.balanceCredit - paymentAmount,
                    currentBalance: wallet.balanceCredit
                }
            }).save({ session });
        }

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
        }, session);

        // Dispatch Service Fee Receipt Email
        const user = await User.findById(providerId).session(session);
        if (user?.email) {
            await notificationQueue.addNotificationToQueue({
                type: 'EMAIL',
                email: user.email,
                templateCode: 'SERVICE_FEE_RECEIPT',
                templateData: {
                    firstName: user.firstName,
                    amount: paymentAmount.toString(),
                    currency: wallet.currency,
                    vendor: vendor === 'CREDIT' ? 'Internal Credit' : vendor
                },
                countryCode: wallet.countryCode
            });
        }

        await session.commitTransaction();
        res.status(200).json({
            success: true,
            message: 'Service fee paid successfully',
            data: {
                paymentAmount,
                serviceFeeBalance: wallet.serviceFeeBalance,
                balanceMain: wallet.balanceMain,
                balanceCredit: wallet.balanceCredit,
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


