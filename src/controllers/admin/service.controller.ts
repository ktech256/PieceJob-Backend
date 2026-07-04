import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Service from '../../models/Service';
import PricingRule from '../../models/PricingRule';
import * as auditService from '../../services/audit.service';

export const listServices = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.query.countryCode as string || req.user?.countryCode || 'GLOBAL';
    // Fetch both global services and country-specific ones for management
    const services = await Service.find({
      $or: [
        { countryCode: 'GLOBAL' },
        { countryCode }
      ]
    }).sort({ category: 1, code: 1, countryCode: -1 }); // Prefer specific countryCode first for same code

    res.status(200).json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch services', error });
  }
};

export const getServiceByCode = async (req: AuthRequest, res: Response) => {
    try {
        const { code } = req.params;
        const countryCode = req.user?.countryCode || 'GLOBAL';
        const service = await Service.findOne({
            code,
            countryCode: { $in: [countryCode, 'GLOBAL'] }
        }).sort({ countryCode: -1 });

        if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
        res.status(200).json({ success: true, service });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch service', error });
    }
};

export const createService = async (req: AuthRequest, res: Response) => {
  try {
    const { code, name, category, genderRule, verificationLevel, equipmentRequired, isActive, countryCode, description, icon, bookingFee, photoSharingRequired, priceNegotiationRequired } = req.body;
    const service = new Service({
        code, name, category, genderRule, verificationLevel, equipmentRequired, isActive, countryCode, description, icon, bookingFee, photoSharingRequired, priceNegotiationRequired
    });
    await service.save();
    res.status(201).json({ success: true, service });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateService = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { code, name, category, genderRule, verificationLevel, equipmentRequired, isActive, countryCode, description, icon, bookingFee, photoSharingRequired, priceNegotiationRequired } = req.body;

    const service = await Service.findByIdAndUpdate(id, {
        code, name, category, genderRule, verificationLevel, equipmentRequired, isActive, countryCode, description, icon, bookingFee, photoSharingRequired, priceNegotiationRequired
    }, { new: true });

    res.status(200).json({ success: true, service });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteService = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    // We don't delete, we deactivate in UI, but this is for full CRUD
    await Service.findByIdAndDelete(id);
    res.status(200).json({ success: true, message: 'Service deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleServiceStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    const service = await Service.findByIdAndUpdate(id, { isActive }, { new: true });

    // FORENSIC: Log modification for audit
    await auditService.logAdminAction({
        countryCode: service?.countryCode || 'GLOBAL',
        adminId: req.user?.userId as string,
        adminRole: req.user?.role as string,
        action: 'SERVICE_TOGGLE_STATUS',
        entityType: 'Service',
        entityId: id,
        afterState: { isActive },
        ipAddress: req.ip,
        systemSource: 'ADMIN_DASHBOARD'
    });

    res.status(200).json({ success: true, service });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Legacy support or combined view
export const updateServiceRules = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceCode } = req.params;
    const update = req.body;
    const service = await PricingRule.findOneAndUpdate(
        { serviceCode, countryCode: req.user?.countryCode },
        update,
        { new: true }
    );
    res.status(200).json({ success: true, service });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};
