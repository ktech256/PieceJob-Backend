import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { UserRole } from '../models/User';

/**
 * Granular Permission Matrix
 * Defined based on Section 4 & 5 of Page 14 Spec.
 */
const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
    [UserRole.SUPER_ADMIN]: ['*'], // Master Clearance
    [UserRole.ADMIN]: ['*'], // Legacy General Admin

    [UserRole.COUNTRY_ADMIN]: [
        'MANAGE_PROVIDERS',
        'MANAGE_CUSTOMERS',
        'MANAGE_JOBS',
        'VIEW_REPORTS',
        'MANAGE_VERIFICATION',
        'MANAGE_PRICING',
        'VIEW_AUDIT'
    ],

    [UserRole.FINANCE_ADMIN]: [
        'MANAGE_FINANCE',
        'MANAGE_WALLETS',
        'MANAGE_PAYOUTS',
        'VIEW_FINANCIAL_REPORTS'
    ],

    [UserRole.VERIFICATION_ADMIN]: [
        'MANAGE_VERIFICATION'
    ],

    [UserRole.SUPPORT_ADMIN]: [
        'MANAGE_SUPPORT',
        'MANAGE_DISPUTES',
        'MANAGE_SOS',
        'VIEW_CHATS'
    ],

    [UserRole.READ_ONLY_ADMIN]: [
        'VIEW_PROVIDERS',
        'VIEW_CUSTOMERS',
        'VIEW_JOBS',
        'VIEW_REPORTS'
    ],

    // Non-admin roles
    [UserRole.CUSTOMER]: [],
    [UserRole.PROVIDER]: [],
    [UserRole.CORPORATE_OWNER]: [],
    [UserRole.CORPORATE_ADMIN]: [],
    [UserRole.CORPORATE_EMPLOYEE]: []
};

export const hasPermission = (permission: string) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

        const userPermissions = ROLE_PERMISSIONS[req.user.role] || [];

        if (userPermissions.includes('*') || userPermissions.includes(permission)) {
            return next();
        }

        // Specific block logic for Finance/Verification cross-access
        if (req.user.role === UserRole.FINANCE_ADMIN && permission === 'MANAGE_VERIFICATION') {
            return res.status(403).json({ success: false, message: 'Finance Admin blocked from Verification' });
        }
        if (req.user.role === UserRole.VERIFICATION_ADMIN && permission === 'MANAGE_FINANCE') {
            return res.status(403).json({ success: false, message: 'Verification Admin blocked from Finance' });
        }

        return res.status(403).json({ success: false, message: `Access denied: Missing permission ${permission}` });
    };
};
