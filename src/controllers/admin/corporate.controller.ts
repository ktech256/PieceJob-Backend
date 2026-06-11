import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Company from '../../models/Company';
import User, { UserRole } from '../../models/User';
import CorporateSchedule from '../../models/CorporateSchedule';
import Job, { JobStatus } from '../../models/Job';
import Ledger from '../../models/Ledger';
import AuditLog from '../../models/AuditLog';

export const listCompanies = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const companies = await Company.find(query).populate('ownerId', 'firstName lastName email').sort({ createdAt: -1 });

        const enhancedCompanies = await Promise.all(companies.map(async (company) => {
            const employeeCount = await User.countDocuments({ companyId: company._id });
            const jobsCount = await Job.countDocuments({
                customerId: { $in: await User.find({ companyId: company._id }).distinct('_id') }
            });
            const spendAgg = await Ledger.aggregate([
                { $match: { fromUserId: { $in: await User.find({ companyId: company._id }).distinct('_id') }, status: 'COMPLETED' } },
                { $group: { _id: null, total: { $sum: "$amount" } } }
            ]);

            return {
                ...company.toObject(),
                metrics: {
                    employeeCount,
                    totalJobs: jobsCount,
                    lifetimeSpend: spendAgg[0]?.total || 0
                }
            };
        }));

        res.status(200).json({ success: true, companies: enhancedCompanies });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list companies', error });
    }
};

export const updateCompanyStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const oldCompany = await Company.findById(id);
        const company = await Company.findByIdAndUpdate(id, { status }, { new: true });

        await AuditLog.create({
            adminId: req.user?.userId,
            action: 'COMPANY_STATUS_UPDATE',
            targetId: id,
            targetCollection: 'Companies',
            previousValue: { status: oldCompany?.status },
            newValue: { status },
            ipAddress: req.ip
        });

        res.status(200).json({ success: true, company });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};

export const getCompanySchedules = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const schedules = await CorporateSchedule.find({ companyId: id });
        res.status(200).json({ success: true, schedules });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch schedules', error });
    }
};

export const updateDocumentStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id, docId } = req.params;
        const { status } = req.body;

        const company = await Company.findOneAndUpdate(
            { _id: id, "documents._id": docId },
            { $set: { "documents.$.status": status } },
            { new: true }
        );

        await AuditLog.create({
            adminId: req.user?.userId,
            action: 'COMPANY_DOC_STATUS_UPDATE',
            targetId: `${id}/${docId}`,
            targetCollection: 'Companies',
            newValue: { status },
            ipAddress: req.ip
        });

        res.status(200).json({ success: true, company });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};
