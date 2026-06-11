import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User, { UserRole } from '../../models/User';
import bcrypt from 'bcryptjs';
import * as auditService from '../../services/audit.service';

/**
 * Super Admin only: List all administrative users
 */
export const listAdmins = async (req: AuthRequest, res: Response) => {
    try {
        const adminRoles = [
            UserRole.SUPER_ADMIN,
            UserRole.COUNTRY_ADMIN,
            UserRole.FINANCE_ADMIN,
            UserRole.VERIFICATION_ADMIN,
            UserRole.SUPPORT_ADMIN,
            UserRole.READ_ONLY_ADMIN
        ];

        const admins = await User.find({ role: { $in: adminRoles } })
            .select('-passwordHash')
            .sort({ createdAt: -1 });

        res.status(200).json({ success: true, admins });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list admins', error });
    }
};

/**
 * Create a new administrative user
 */
export const createAdmin = async (req: AuthRequest, res: Response) => {
    try {
        const { firstName, lastName, email, phoneNumber, password, role, countryCode } = req.body;

        const existing = await User.findOne({ $or: [{ email }, { phoneNumber }] });
        if (existing) return res.status(400).json({ success: false, message: 'User already exists' });

        const passwordHash = await bcrypt.hash(password, 10);
        const admin = new User({
            firstName,
            lastName,
            email,
            phoneNumber,
            passwordHash,
            role,
            countryCode,
            isVerified: true
        });

        await admin.save();

        await auditService.logAdminAction({
            countryCode: admin.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'ADMIN_CREATED',
            entityType: 'User',
            entityId: admin.id,
            afterState: { role: admin.role, email: admin.email },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(201).json({ success: true, admin });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * Update admin role or workspace
 */
export const updateAdmin = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { role, countryCode, isBanned } = req.body;

        const oldAdmin = await User.findById(id);
        if (!oldAdmin) return res.status(404).json({ success: false, message: 'Admin not found' });

        const admin = await User.findByIdAndUpdate(id, { role, countryCode, isBanned }, { new: true });

        await auditService.logAdminAction({
            countryCode: admin?.countryCode || 'GLOBAL',
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'ADMIN_UPDATED',
            entityType: 'User',
            entityId: id,
            beforeState: { role: oldAdmin.role, countryCode: oldAdmin.countryCode, isBanned: oldAdmin.isBanned },
            afterState: { role: admin?.role, countryCode: admin?.countryCode, isBanned: admin?.isBanned },
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(200).json({ success: true, admin });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
