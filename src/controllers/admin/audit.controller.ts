import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import AuditLog from '../../models/AuditLog';

import { AuditType } from '../../models/AuditLog';

export const listAuditLogs = async (req: AuthRequest, res: Response) => {
    try {
        const { auditType, countryCode, userId, adminId, jobId, transactionId, category, search } = req.query;
        const query: any = {};

        // Handle category alias from Dashboard
        if (category === 'FINANCE') {
            query.auditType = AuditType.FINANCIAL_MUTATION;
        } else if (auditType) {
            query.auditType = auditType;
        }

        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (userId) query.userId = userId;
        if (adminId) query.adminId = adminId;
        if (jobId) query["financialInfo.jobId"] = jobId;
        if (transactionId) query["financialInfo.transactionId"] = transactionId;

        if (search) {
            query.$or = [
                { action: { $regex: search, $options: 'i' } },
                { entityId: { $regex: search, $options: 'i' } },
                { "financialInfo.transactionId": { $regex: search, $options: 'i' } }
            ];
        }

        const logs = await AuditLog.find(query)
            .populate('adminId', 'firstName lastName email')
            .populate('userId', 'firstName lastName email')
            .sort({ timestampUTC: -1, createdAt: -1 })
            .limit(200);

        res.status(200).json({ success: true, logs });
    } catch (error: any) {
        res.status(500).json({ success: false, message: 'Failed to fetch logs', error: error.message });
    }
};
