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
}, session?: mongoose.ClientSession) => {
    const { countryCode, adminId, adminRole, action, entityType, entityId, beforeState, afterState, ipAddress, deviceInfo, systemSource } = data;

    return await new AuditLog({
        auditId: `AUD-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.ADMIN_ACTION,
        systemSource: systemSource || 'ADMIN_DASHBOARD',
        countryCode,
        adminId: (adminId && adminId !== 'SYSTEM' && mongoose.Types.ObjectId.isValid(adminId)) ? adminId : undefined,
        adminRole,
        action,
        entityType,
        entityId,
        beforeState,
        afterState,
        ipAddress,
        deviceInfo,
        timestampUTC: new Date()
    }).save({ session });
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
    reason?: string;
    disputeId?: string;
    ipAddress?: string;
    deviceInfo?: string;
    systemSource?: string;
}, session?: mongoose.ClientSession) => {
    const { countryCode, userId, action, financialInfo, adminId, reason, disputeId, ipAddress, deviceInfo, systemSource } = data;

    return await new AuditLog({
        auditId: `FIN-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.FINANCIAL_MUTATION,
        systemSource: systemSource || 'API',
        countryCode,
        userId: new mongoose.Types.ObjectId(userId),
        adminId: (adminId && adminId !== 'SYSTEM' && mongoose.Types.ObjectId.isValid(adminId as string)) ? new mongoose.Types.ObjectId(adminId as string) : undefined,
        action,
        financialInfo: {
            ...financialInfo,
            jobId: financialInfo.jobId ? new mongoose.Types.ObjectId(financialInfo.jobId) : undefined
        },
        afterState: { reason, disputeId },
        ipAddress,
        deviceInfo,
        timestampUTC: new Date()
    }).save({ session });
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
    const { countryCode, userId, action, modificationType, beforeState, afterState, adminId, ipAddress, deviceInfo, systemSource } = data;

    return await new AuditLog({
        auditId: `USR-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.USER_MODIFICATION,
        systemSource: systemSource || 'API',
        countryCode,
        userId,
        action,
        beforeState,
        afterState,
        adminId: (adminId && adminId !== 'SYSTEM' && mongoose.Types.ObjectId.isValid(adminId as string)) ? adminId : undefined,
        ipAddress,
        deviceInfo,
        timestampUTC: new Date()
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
    const { countryCode, adminId, adminRole, chatInfo, ipAddress, systemSource } = data;

    return await new AuditLog({
        auditId: `CHT-${uuidv4().split('-')[0].toUpperCase()}`,
        auditType: AuditType.CHAT_ACCESS,
        action: 'CHAT_VIEW',
        systemSource: systemSource || 'ADMIN_DASHBOARD',
        countryCode,
        adminId: (adminId && adminId !== 'SYSTEM' && mongoose.Types.ObjectId.isValid(adminId)) ? adminId : undefined,
        adminRole,
        chatInfo,
        ipAddress,
        timestampUTC: new Date()
    }).save();
};
