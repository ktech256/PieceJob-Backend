import mongoose from 'mongoose';
import AuditLog, { AuditType, IAuditLog } from '../models/AuditLog';
import { v4 as uuidv4 } from 'uuid';

export const logAdminAction = async (data: {
    countryCode: string;
    adminId: string;
    adminRole: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: any;
    afterState?: any;
    ipAddress?: string;
    deviceInfo?: string;
    systemSource?: string;
}) => {
    return await new AuditLog({
        auditId: `AUD-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.ADMIN_ACTION,
        systemSource: data.systemSource || 'ADMIN_DASHBOARD',
        timestampUTC: new Date(),
        ...data
    }).save();
};

export const logFinancialMutation = async (data: {
    countryCode: string;
    userId: string;
    action: string;
    financialInfo: {
        transactionId: string;
        jobId?: string;
        walletType: string;
        mutationType: 'CREDIT' | 'DEBIT';
        amountBase: number;
        amountUSD: number;
        currency: string;
        previousBalance: number;
        newBalance: number;
    };
    adminId?: string;
    systemSource?: string;
}, session?: mongoose.ClientSession) => {
    const log = new AuditLog({
        auditId: `FIN-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.FINANCIAL_MUTATION,
        systemSource: data.systemSource || 'API',
        timestampUTC: new Date(),
        ...data
    });
    return await log.save({ session });
};

export const logUserModification = async (data: {
    countryCode: string;
    userId: string;
    action: string;
    modificationType: string;
    beforeState?: any;
    afterState?: any;
    triggeredBy: 'USER' | 'ADMIN' | 'SYSTEM';
    adminId?: string;
    ipAddress?: string;
    deviceInfo?: string;
    systemSource?: string;
}) => {
    return await new AuditLog({
        auditId: `USR-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.USER_MODIFICATION,
        systemSource: data.systemSource || 'API',
        timestampUTC: new Date(),
        ...data
    }).save();
};

export const logChatAccess = async (data: {
    countryCode: string;
    adminId: string;
    adminRole: string;
    chatInfo: {
        jobId: string;
        chatId?: string;
        accessReason: string;
        userViewed: string;
    };
    ipAddress?: string;
    systemSource?: string;
}) => {
    return await new AuditLog({
        auditId: `CHT-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.CHAT_ACCESS,
        action: 'CHAT_VIEW',
        systemSource: data.systemSource || 'ADMIN_DASHBOARD',
        timestampUTC: new Date(),
        ...data
    }).save();
};
