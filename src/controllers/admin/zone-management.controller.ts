import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Zone from '../../models/Zone';

export const listZones = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const zones = await Zone.find(query);
        res.status(200).json({ success: true, data: zones });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch zones' });
    }
};

export const createZone = async (req: AuthRequest, res: Response) => {
    try {
        const zone = new Zone({
            ...req.body,
            createdBy: req.user?.userId,
            updatedBy: req.user?.userId
        });
        await zone.save();
        res.status(201).json({ success: true, data: zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateZone = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const zone = await Zone.findByIdAndUpdate(
            id,
            { ...req.body, updatedBy: req.user?.userId },
            { new: true }
        );
        res.status(200).json({ success: true, data: zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const toggleZoneStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        const zone = await Zone.findByIdAndUpdate(id, { isActive }, { new: true });
        res.status(200).json({ success: true, data: zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteZone = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        await Zone.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Zone deleted' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
