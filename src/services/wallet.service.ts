import mongoose from 'mongoose';
import Wallet, { IWallet } from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import { v4 as uuidv4 } from 'uuid';
import * as auditService from './audit.service';

export interface WalletMutationOptions {
    userId: string;
    amount: number;
    type: TransactionType;
    balanceType: 'balanceMain' | 'balanceEscrow' | 'balanceCredit' | 'balanceReferral' | 'balanceBonus';
    description: string;
    jobId?: string;
    countryCode: string;
    currency: string;
    metadata?: any;
    session?: mongoose.ClientSession;
    status?: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';
}

/**
 * Perform an atomic wallet mutation and record it in the immutable Ledger.
 */
export const mutateWallet = async (options: WalletMutationOptions) => {
    const { userId, amount, type, balanceType, description, jobId, countryCode, currency, metadata, session, status = 'COMPLETED' } = options;

    if (amount === 0) return;

    // 1. Validation for Debits
    if (amount < 0) {
        const currentWallet = await Wallet.findOne({ userId: new mongoose.Types.ObjectId(userId) }).session(session as any);
        if (!currentWallet || (currentWallet as any)[balanceType] < Math.abs(amount)) {
            if (balanceType === 'balanceMain' && !metadata?.allowNegative) {
                throw new Error(`Insufficient funds in ${balanceType}`);
            }
        }
    }

    // 2. Update/Create Wallet
    const wallet = await Wallet.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(userId) },
        {
            $inc: { [balanceType]: amount },
            $setOnInsert: { countryCode, currency }
        },
        { session, upsert: true, new: true }
    );

    // 2. Create Ledger Entry
    const ledger = new Ledger({
        transactionId: `TX-${uuidv4().split('-')[0].toUpperCase()}-${Date.now().toString().slice(-6)}`,
        jobId: jobId ? new mongoose.Types.ObjectId(jobId) : undefined,
        [amount >= 0 ? 'toUserId' : 'fromUserId']: new mongoose.Types.ObjectId(userId),
        amount: Math.abs(amount),
        currency,
        countryCode,
        type,
        status,
        description,
        metadata: {
            ...metadata,
            balanceAffected: balanceType,
            previousBalance: (wallet as any)[balanceType] - amount,
            newBalance: (wallet as any)[balanceType]
        }
    });
    await ledger.save({ session });

    // 3. Log Financial Mutation for Audit
    await auditService.logFinancialMutation({
        countryCode,
        userId,
        action: type.toString() as any,
        financialInfo: {
            transactionId: ledger.transactionId,
            jobId,
            walletType: balanceType,
            mutationType: amount >= 0 ? 'CREDIT' : 'DEBIT',
            amountBase: Math.abs(amount),
            amountUSD: Math.abs(amount), // Future: Implement exchange rates
            currency,
            previousBalance: (wallet as any)[balanceType] - amount,
            newBalance: (wallet as any)[balanceType]
        },
        systemSource: 'API'
    }, session);

    return { wallet, ledger };
};

/**
 * Transfer funds between two users or from platform to user.
 */
export const transferFunds = async (fromUserId: string | null, toUserId: string | null, amount: number, type: TransactionType, options: Partial<WalletMutationOptions>) => {
    // Implementation for multi-leg transactions if needed.
    // For now, mutateWallet handles individual user perspectives.
};

export const getWalletBalance = async (userId: string) => {
    return await Wallet.findOne({ userId: new mongoose.Types.ObjectId(userId) });
};

export const getTransactionHistory = async (userId: string, filters: any = {}) => {
    const query: any = {
        $or: [
            { fromUserId: new mongoose.Types.ObjectId(userId) },
            { toUserId: new mongoose.Types.ObjectId(userId) }
        ],
        ...filters
    };
    return await Ledger.find(query).sort({ createdAt: -1 }).limit(100);
};
