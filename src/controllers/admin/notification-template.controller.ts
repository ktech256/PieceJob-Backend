import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as templateService from '../../services/notification-template.service';

export const listTemplates = async (req: AuthRequest, res: Response) => {
    try {
        const { channel, countryCode } = req.query;
        const query: any = {};
        if (channel) query.channel = channel;
        if (countryCode) query.countryCode = countryCode;

        const templates = await templateService.listTemplates(query);
        res.status(200).json({ success: true, templates });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch templates', error });
    }
};

export const createTemplate = async (req: AuthRequest, res: Response) => {
    try {
        const template = await templateService.createTemplate({
            ...req.body,
            createdBy: req.user?.userId,
            updatedBy: req.user?.userId
        });
        res.status(201).json({ success: true, template });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create template', error });
    }
};

export const updateTemplate = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const template = await templateService.updateTemplate(id, {
            ...req.body,
            updatedBy: req.user?.userId
        });
        res.status(200).json({ success: true, template });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update template', error });
    }
};
