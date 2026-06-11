import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import AuditLog from '../../models/AuditLog';

export const listAuditLogs = async (req: AuthRequest, res: Response) => {
    try {
        const { auditType, countryCode, userId, adminId, jobId, transactionId } = req.query;
        const query: any = {};

        if (auditType) query.auditType = auditType;
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (userId) query.userId = userId;
        if (adminId) query.adminId = adminId;
        if (jobId) query["financialInfo.jobId"] = jobId;
        if (transactionId) query["financialInfo.transactionId"] = transactionId;

        const logs = await AuditLog.find(query)
            .populate('adminId', 'firstName lastName')
            .populate('userId', 'firstName lastName')
            .sort({ timestampUTC: -1, createdAt: -1 })
            .limit(100);

        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch logs', error });
    }
};
