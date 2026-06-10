import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Pricing from '../../models/Pricing';

export const listServices = async (req: AuthRequest, res: Response) => {
  try {
    const services = await Pricing.find({ countryCode: req.user?.countryCode });
    res.status(200).json({ success: true, services });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch services', error });
  }
};

export const updateServiceRules = async (req: AuthRequest, res: Response) => {
  try {
    const { serviceCode } = req.params;
    const update = req.body;
    const service = await Pricing.findOneAndUpdate(
        { serviceCode, countryCode: req.user?.countryCode },
        update,
        { new: true }
    );
    res.status(200).json({ success: true, service });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};
