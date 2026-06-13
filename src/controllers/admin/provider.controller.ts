import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Provider from '../../models/Provider';
import User from '../../models/User';

export const getProvidersMonitor = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const providers = await Provider.find({ countryCode })
            .populate('userId', 'firstName lastName email phoneNumber')
            .sort({ isOnline: -1, updatedAt: -1 });

        res.status(200).json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch monitor data', error });
    }
};

export const getProvidersPerformance = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const providers = await Provider.find({ countryCode })
            .select('userId tier rating acceptanceRate completionRate')
            .populate('userId', 'firstName lastName')
            .sort({ rating: -1 });

        res.status(200).json({ success: true, providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch performance data', error });
    }
};

export const approveAddressChange = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId } = req.params;
        const provider = await Provider.findById(providerId);
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const user = await User.findById(provider.userId);
        if (!user || !user.pendingAddress) return res.status(400).json({ success: false, message: 'No pending address change' });

        user.province = user.pendingAddress.province;
        user.city = user.pendingAddress.city;
        user.address = user.pendingAddress.address;
        user.pendingAddress = undefined;
        await user.save();

        res.status(200).json({ success: true, message: 'Address change approved' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to approve address change', error });
    }
};

export const rejectAddressChange = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId } = req.params;
        const { reason } = req.body;
        const provider = await Provider.findById(providerId);
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        const user = await User.findById(provider.userId);
        if (!user || !user.pendingAddress) return res.status(400).json({ success: false, message: 'No pending address change' });

        user.pendingAddress.status = 'REJECTED';
        // user.pendingAddress.rejectionReason = reason;
        await user.save();

        res.status(200).json({ success: true, message: 'Address change rejected' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to reject address change', error });
    }
};

export const listPendingAddressChanges = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const query: any = { 'pendingAddress.status': 'PENDING' };
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const users = await User.find(query).select('firstName lastName email pendingAddress countryCode');
        res.status(200).json({ success: true, queue: users });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch address queue', error });
    }
};

export const listPendingBankDetails = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const query: any = { 'bankDetails.isVerified': false, 'bankDetails.accountNumberEncrypted': { $exists: true, $ne: null } };
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const providers = await Provider.find(query)
            .populate('userId', 'firstName lastName email phoneNumber')
            .select('bankDetails userId countryCode');

        res.status(200).json({ success: true, queue: providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch banking queue', error });
    }
};

export const approveBankDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId } = req.params;
        const provider = await Provider.findByIdAndUpdate(
            providerId,
            { 'bankDetails.isVerified': true },
            { new: true }
        );
        res.status(200).json({ success: true, message: 'Banking details approved', data: provider?.bankDetails });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to approve banking details', error });
    }
};

export const rejectBankDetails = async (req: AuthRequest, res: Response) => {
    try {
        const { providerId } = req.params;
        // In real app, we might set bankDetails to null or flag it
        const provider = await Provider.findByIdAndUpdate(
            providerId,
            { 'bankDetails.isVerified': false, 'bankDetails.accountNumberEncrypted': null },
            { new: true }
        );
        res.status(200).json({ success: true, message: 'Banking details rejected' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to reject banking details', error });
    }
};
