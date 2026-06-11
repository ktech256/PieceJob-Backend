import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Country from '../../models/Country';
import * as auditService from '../../services/audit.service';

export const listCountries = async (req: AuthRequest, res: Response) => {
  try {
    const countries = await Country.find();
    res.status(200).json({ success: true, countries });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch countries', error });
  }
};

export const createCountry = async (req: AuthRequest, res: Response) => {
  try {
    const country = new Country({
        ...req.body,
        createdBy: req.user?.userId
    });
    await country.save();

    await auditService.logAdminAction({
        countryCode: country.code,
        adminId: req.user?.userId as string,
        adminRole: req.user?.role as string,
        action: 'WORKSPACE_CREATED',
        entityType: 'Country',
        entityId: country.id,
        afterState: country.toObject(),
        ipAddress: req.ip,
        systemSource: 'ADMIN_DASHBOARD'
    });

    res.status(201).json({ success: true, country });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCountry = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const oldCountry = await Country.findById(id);
        const country = await Country.findByIdAndUpdate(id, req.body, { new: true });

        if (country) {
            await auditService.logAdminAction({
                countryCode: country.code,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: 'WORKSPACE_UPDATED',
                entityType: 'Country',
                entityId: id,
                beforeState: oldCountry?.toObject(),
                afterState: country.toObject(),
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

        res.status(200).json({ success: true, country });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
