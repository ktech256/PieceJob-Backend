import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import PaymentProvider from '../../models/PaymentProvider';

export const listProviders = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.headers['x-country-code'] as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const providers = await PaymentProvider.find(query).sort({ priority: 1 });
        res.status(200).json({ success: true, data: providers });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch payment providers', error });
    }
};

export const createProvider = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.headers['x-country-code'] as string || req.user?.countryCode;

        const provider = new PaymentProvider({
            ...req.body,
            countryCode: req.body.countryCode || countryCode,
            updatedBy: req.user?.userId
        });
        await provider.save();
        res.status(201).json({ success: true, data: provider });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message || 'Failed to create provider' });
    }
};

export const updateProvider = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const provider = await PaymentProvider.findByIdAndUpdate(
            id,
            { ...req.body, updatedBy: req.user?.userId },
            { new: true }
        );
        res.status(200).json({ success: true, data: provider });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update provider', error });
    }
};

export const getAvailableMethods = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode || 'ZA';
        const providers = await PaymentProvider.find({
            countryCode: countryCode,
            isActive: true
        }).sort({ priority: 1 });

        // Return only what Android needs to display
        const methods = providers.map(p => ({
            code: p.code,
            name: p.name,
            publicKey: p.publicKey, // For client-side SDKs
            environment: p.environment
        }));

        res.status(200).json({ success: true, data: methods });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch payment methods' });
    }
};

export const deleteProvider = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        await PaymentProvider.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Provider removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
};
