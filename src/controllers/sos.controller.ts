import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import SosIncident, { SosStatus } from '../models/SosIncident';
import SosEvidence from '../models/SosEvidence';
import SosTimeline from '../models/SosTimeline';
import * as sosService from '../services/sos.service';

export const listIncidents = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode, status } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (status) query.status = status;

        const incidents = await SosIncident.find(query)
            .populate('userId', 'firstName lastName phoneNumber')
            .sort({ activatedAt: -1 });

        res.status(200).json({ success: true, incidents });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list incidents', error });
    }
};

export const getIncidentDetail = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const incident = await SosIncident.findById(id).populate('userId', 'firstName lastName phoneNumber');
        if (!incident) return res.status(404).json({ success: false, message: 'Incident not found' });

        const evidence = await SosEvidence.findOne({ incidentId: id });
        const timeline = await SosTimeline.findOne({ incidentId: id });

        res.status(200).json({ success: true, incident, evidence, timeline });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch details', error });
    }
};

export const triggerSos = async (req: AuthRequest, res: Response) => {
    try {
        const { coordinates, jobId } = req.body;
        const userId = req.user?.userId as string;
        const userType = req.user?.role as 'CUSTOMER' | 'PROVIDER';
        const countryCode = req.user?.countryCode as string;

        const incident = await sosService.activateSos(userId, userType, coordinates, countryCode, jobId);

        res.status(201).json({ success: true, incidentId: incident.incidentId, _id: incident._id });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateStatus = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { status, reason } = req.body;
        const adminId = req.user?.userId as string;

        let incident;
        if (status === SosStatus.ARCHIVED) {
            incident = await sosService.archiveIncident(id, adminId);
        } else {
            incident = await sosService.updateIncidentStatus(id, status as SosStatus, adminId, reason);
        }

        res.status(200).json({ success: true, incident });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const uploadAudio = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { url, duration } = req.body; // Audio segment from app

        await SosEvidence.findOneAndUpdate(
            { incidentId: id },
            { $push: { audioStream: { url, duration, timestamp: new Date() } } }
        );

        res.status(200).json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const uploadPhoto = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { url, coordinates } = req.body;

        await SosEvidence.findOneAndUpdate(
            { incidentId: id },
            { $push: { photos: { url, gpsPosition: coordinates, timestamp: new Date() } } }
        );

        res.status(200).json({ success: true });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
