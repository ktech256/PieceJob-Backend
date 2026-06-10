import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User from '../../models/User';

export const listUsers = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.query.countryCode as string || req.user?.countryCode;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    const users = await User.find(query).select('-passwordHash').sort({ createdAt: -1 });
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users', error });
  }
};
