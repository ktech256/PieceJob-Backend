import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Company from '../../models/Company';
import User, { UserRole } from '../../models/User';
import CorporateSchedule from '../../models/CorporateSchedule';
import Job, { JobStatus } from '../../models/Job';
import Ledger from '../../models/Ledger';
import * as auditService from '../../services/audit.service';

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

        if (company) {
            await auditService.logAdminAction({
                countryCode: company.countryCode,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: 'COMPANY_STATUS_UPDATE',
                entityType: 'Companies',
                entityId: id,
                beforeState: { status: oldCompany?.status },
                afterState: { status },
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

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

        if (company) {
            await auditService.logAdminAction({
                countryCode: company.countryCode,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: 'COMPANY_DOC_STATUS_UPDATE',
                entityType: 'Companies',
                entityId: `${id}/${docId}`,
                afterState: { status },
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

        res.status(200).json({ success: true, company });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};
