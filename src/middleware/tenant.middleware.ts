import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { UserRole } from '../models/User';

/**
 * Tenant Middleware
 * Injects countryCode into the request based on headers or user profile.
 * Enforces logical workspace isolation for multi-tenant data sets.
 */
export const tenantContext = (req: AuthRequest, res: Response, next: NextFunction) => {
  const headerCountry = req.headers['x-country-code'] as string;

  if (req.user) {
    const targetCountry = headerCountry || (req.query.countryCode as string);

    // 1. GLOBAL Workspace is restricted to SUPER_ADMIN
    if (targetCountry === 'GLOBAL' && req.user.role !== UserRole.SUPER_ADMIN) {
        return res.status(403).json({ success: false, message: 'Global Workspace Restricted to Super Admin' });
    }

    // 2. Super Admin can switch to any workspace
    if (req.user.role === UserRole.SUPER_ADMIN) {
        if (targetCountry) {
            req.user.countryCode = targetCountry;
        }
    } else {
        // 3. Standard Admin / Users are locked to their profile countryCode
        if (targetCountry && targetCountry !== req.user.countryCode) {
            return res.status(403).json({ success: false, message: 'Tenant Access Denied: Cross-Country Prohibited' });
        }
    }
  }

  next();
};
