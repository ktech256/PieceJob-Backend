import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Zone from '../../models/Zone';
import Provider from '../../models/Provider';
import Job from '../../models/Job';
import Service from '../../models/Service';

export const listZones = async (req: AuthRequest, res: Response) => {
// ...
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
        const countryCode = req.user?.countryCode || 'ZA';
        const zone = new Zone({
            ...req.body,
            countryCode: req.body.countryCode || countryCode,
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

export const getZoneStats = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const zone = await Zone.findById(id);
        if (!zone) return res.status(404).json({ success: false, message: 'Zone not found' });

        // 1. Online Providers in Zone
        const onlineProviders = await Provider.countDocuments({
            countryCode: zone.countryCode,
            isOnline: true,
            currentAvailabilityStatus: 'ONLINE',
            location: {
                $geoIntersects: {
                    $geometry: zone.boundary
                }
            }
        });

        // 2. Jobs completed in Zone
        const completedJobs = await Job.countDocuments({
            countryCode: zone.countryCode,
            status: 'COMPLETED',
            location: {
                $geoIntersects: {
                    $geometry: zone.boundary
                }
            }
        });

        // 3. Services available in this country/workspace
        const servicesAvailable = await Service.countDocuments({
            $or: [{ countryCode: zone.countryCode }, { countryCode: 'GLOBAL' }],
            isActive: true
        });

        res.status(200).json({
            success: true,
            data: {
                onlineProviders,
                completedJobs,
                servicesAvailable
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
