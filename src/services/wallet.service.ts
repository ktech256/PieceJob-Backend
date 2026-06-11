import mongoose from 'mongoose';
import Wallet from '../models/Wallet';
import Ledger, { TransactionType } from '../models/Ledger';
import { v4 as uuidv4 } from 'uuid';
import * as auditService from './audit.service';

export enum WalletType {
    MAIN = 'balanceMain',
    ESCROW = 'balanceEscrow',
    CREDIT = 'balanceCredit',
    REFERRAL = 'balanceReferral',
    BONUS = 'balanceBonus'
}

export const mutateWallet = async (
    userId: string,
    amount: number,
    type: WalletType,
    transactionType: TransactionType,
    metadata: any = {},
    adminId?: string
) => {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
        const wallet = await Wallet.findOne({ userId }).session(session);
        if (!wallet) throw new Error('Wallet not found');

        const previousBalance = (wallet as any)[type];
        (wallet as any)[type] += amount;
        await wallet.save({ session });

        const transactionId = uuidv4();

        // 1. Create Ledger Entry
        const ledger = new Ledger({
            transactionId,
            fromUserId: amount < 0 ? userId : undefined,
            toUserId: amount > 0 ? userId : undefined,
            amount: Math.abs(amount),
            currency: wallet.currency,
            countryCode: wallet.countryCode,
            type: transactionType,
            status: 'COMPLETED',
            metadata: { ...metadata, walletType: type }
        });
        await ledger.save({ session });

        // 2. Create Audit Log (Financial Mutation)
        await auditService.logFinancialMutation({
            countryCode: wallet.countryCode,
            userId,
            action: 'WALLET_MUTATION',
            financialInfo: {
                transactionId,
                jobId: metadata.jobId,
                walletType: type,
                mutationType: amount > 0 ? 'CREDIT' : 'DEBIT',
                amountBase: Math.abs(amount),
                amountUSD: Math.abs(amount), // Assuming base is USD for now, or add conversion logic
                currency: wallet.currency,
                previousBalance,
                newBalance: (wallet as any)[type]
            },
            adminId: adminId as any,
            systemSource: adminId ? 'ADMIN_DASHBOARD' : 'API'
        }, session);

        await session.commitTransaction();
        return { success: true, transactionId, newBalance: (wallet as any)[type] };
    } catch (error) {
        await session.abortTransaction();
        throw error;
    } finally {
        session.endSession();
    }
};
