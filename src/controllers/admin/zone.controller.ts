import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import Zone from '../../models/Zone';
import * as auditService from '../../services/audit.service';
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

    await auditService.logAdminAction({
        countryCode: zone.countryCode,
        adminId: req.user?.userId as string,
        adminRole: req.user?.role as string,
        action: 'ZONE_CREATED',
        entityType: 'Zones',
        entityId: zone.id,
        afterState: zone.toObject(),
        ipAddress: req.ip,
        systemSource: 'ADMIN_DASHBOARD'
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

        if (zone) {
            await auditService.logAdminAction({
                countryCode: zone.countryCode,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: 'ZONE_UPDATED',
                entityType: 'Zones',
                entityId: id,
                beforeState: oldZone.toObject(),
                afterState: zone.toObject(),
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

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

        if (zone) {
            await auditService.logAdminAction({
                countryCode: zone.countryCode,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: 'ZONE_DELETED',
                entityType: 'Zones',
                entityId: id,
                beforeState: zone.toObject(),
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

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

        if (zone) {
            await auditService.logAdminAction({
                countryCode: zone.countryCode,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: isActive ? 'ZONE_ENABLED' : 'ZONE_DISABLED',
                entityType: 'Zones',
                entityId: id,
                afterState: { isActive },
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

        res.status(200).json({ success: true, zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
