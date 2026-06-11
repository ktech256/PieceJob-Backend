import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Zone from '../../models/Zone';
import AuditLog from '../../models/AuditLog';
import PricingRule from '../../models/PricingRule';

const validatePolygon = (boundary: any) => {
    if (!boundary || boundary.type !== 'Polygon' || !Array.isArray(boundary.coordinates)) {
        throw new Error('Invalid GeoJSON Polygon structure');
    }
    const coords = boundary.coordinates[0];
    if (coords.length < 4) {
        throw new Error('Polygon must have at least 4 points (including closed loop)');
    }
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new Error('Polygon must be a closed loop (first and last points must match)');
    }
};

export const listZones = async (req: AuthRequest, res: Response) => {
  try {
    const countryCode = req.query.countryCode as string || req.user?.countryCode;
    const query: any = {};
    if (countryCode && countryCode !== 'GLOBAL') {
      query.countryCode = countryCode;
    }

    const zones = await Zone.find(query).sort({ name: 1 });
    res.status(200).json({ success: true, zones });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch zones', error });
  }
};

export const createZone = async (req: AuthRequest, res: Response) => {
  try {
    const { name, zoneCode, cityName, boundary, isActive } = req.body;
    const countryCode = req.user?.countryCode || req.body.countryCode;

    validatePolygon(boundary);

    const zone = new Zone({
        name,
        zoneCode,
        cityName,
        boundary,
        isActive,
        countryCode,
        createdBy: req.user?.userId
    });

    await zone.save();

    await AuditLog.create({
        adminId: req.user?.userId,
        action: 'ZONE_CREATED',
        targetId: zone.id,
        targetCollection: 'Zones',
        newValue: zone.toObject(),
        ipAddress: req.ip
    });

    res.status(201).json({ success: true, zone });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateZone = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const update = req.body;

        if (update.boundary) {
            validatePolygon(update.boundary);
        }

        const oldZone = await Zone.findById(id);
        if (!oldZone) return res.status(404).json({ success: false, message: 'Zone not found' });

        const zone = await Zone.findByIdAndUpdate(id, {
            ...update,
            updatedBy: req.user?.userId
        }, { new: true });

        await AuditLog.create({
            adminId: req.user?.userId,
            action: 'ZONE_UPDATED',
            targetId: id,
            targetCollection: 'Zones',
            previousValue: oldZone.toObject(),
            newValue: zone?.toObject(),
            ipAddress: req.ip
        });

        res.status(200).json({ success: true, zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteZone = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;

        // Check dependencies
        const linkedPricing = await PricingRule.findOne({ zoneId: id });
        if (linkedPricing) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete zone with active pricing rules. Disable it instead.'
            });
        }

        const zone = await Zone.findByIdAndDelete(id);

        await AuditLog.create({
            adminId: req.user?.userId,
            action: 'ZONE_DELETED',
            targetId: id,
            targetCollection: 'Zones',
            previousValue: zone?.toObject(),
            ipAddress: req.ip
        });

        res.status(200).json({ success: true, message: 'Zone deleted' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const toggleZoneStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;

        const zone = await Zone.findByIdAndUpdate(id, { isActive }, { new: true });

        await AuditLog.create({
            adminId: req.user?.userId,
            action: isActive ? 'ZONE_ENABLED' : 'ZONE_DISABLED',
            targetId: id,
            targetCollection: 'Zones',
            newValue: { isActive },
            ipAddress: req.ip
        });

        res.status(200).json({ success: true, zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
