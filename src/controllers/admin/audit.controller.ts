import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import AuditLog from '../../models/AuditLog';

export const listAuditLogs = async (req: AuthRequest, res: Response) => {
    try {
        const { type } = req.query;
        const query: any = {};
        if (type) query.action = { $regex: type as string, $options: 'i' };

        const logs = await AuditLog.find(query)
            .populate('adminId', 'firstName lastName')
            .sort({ createdAt: -1 })
            .limit(100);

        res.status(200).json({ success: true, logs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch logs', error });
    }
};
