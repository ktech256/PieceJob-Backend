import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Country from '../../models/Country';

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
    const country = new Country(req.body);
    await country.save();
    res.status(201).json({ success: true, country });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create country', error });
  }
};
