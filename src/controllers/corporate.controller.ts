import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Company from '../models/Company';
import User from '../models/User';
import CorporateSchedule from '../models/CorporateSchedule';

export const getMyCompanyProfile = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId);
        if (!user || !user.companyId) return res.status(404).json({ success: false, message: 'Company not found' });

        const company = await Company.findById(user.companyId);
        res.status(200).json({ success: true, data: company });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch company profile', error });
    }
};

export const getMyEmployees = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId);
        if (!user || !user.companyId) return res.status(404).json({ success: false, message: 'Unauthorized' });

        const employees = await User.find({ companyId: user.companyId }).select('-passwordHash');
        res.status(200).json({ success: true, data: employees });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch employees', error });
    }
};

export const getMySchedules = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId);
        if (!user || !user.companyId) return res.status(404).json({ success: false, message: 'Unauthorized' });

        const schedules = await CorporateSchedule.find({ companyId: user.companyId });
        res.status(200).json({ success: true, data: schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch schedules', error });
    }
};
