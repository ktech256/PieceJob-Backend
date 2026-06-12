import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import User from '../../models/User';

export const listUsers = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.user?.countryCode;
    const { isTestUser } = req.query;

    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    if (isTestUser !== undefined) {
      query.isTestUser = isTestUser === 'true';
    }

    const users = await User.find(query).select('-passwordHash').sort({ createdAt: -1 });
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch users', error });
  }
};
