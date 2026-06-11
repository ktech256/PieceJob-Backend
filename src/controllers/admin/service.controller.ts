import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Service from '../../models/Service';
import PricingRule from '../../models/PricingRule';

export const listServices = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.query.countryCode as string || req.user?.countryCode || 'GLOBAL';
    // Fetch both global services and country-specific ones
    const services = await Service.find({
      $or: [
        { countryCode: 'GLOBAL' },
        { countryCode }
      ]
    }).sort({ category: 1, code: 1 });

    res.status(200).json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch services', error });
  }
};

export const createService = async (req: AuthRequest, res: Response) => {
  try {
    const service = new Service(req.body);
    await service.save();
    res.status(201).json({ success: true, service });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateService = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const service = await Service.findByIdAndUpdate(id, req.body, { new: true });
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
