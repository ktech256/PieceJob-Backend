import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import PricingRule, { PricingLevel } from '../../models/PricingRule';
import CommissionRule from '../../models/CommissionRule';
import PriceBotSuggestion from '../../models/PriceBotSuggestion';
import * as pricingService from '../../services/pricing.service';
import * as pricebotService from '../../services/pricebot.service';
import * as auditService from '../../services/audit.service';
import Zone from '../../models/Zone';

export const listPricingRules = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const { level } = req.query;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;
        if (level) query.level = level;

        const rules = await PricingRule.find(query).sort({ level: 1, priority: -1 });
        res.status(200).json({ success: true, rules });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list pricing rules', error });
    }
};

export const createPricingRule = async (req: AuthRequest, res: Response) => {
    try {
        const rule = new PricingRule(req.body);
        await rule.save();

        await auditService.logAdminAction({
            countryCode: rule.countryCode,
            adminId: req.user?.userId as string,
            adminRole: req.user?.role as string,
            action: 'PRICING_RULE_CREATE',
            entityType: 'PricingRule',
            entityId: rule.id,
            afterState: rule.toObject(),
            ipAddress: req.ip,
            systemSource: 'ADMIN_DASHBOARD'
        });

        res.status(201).json({ success: true, rule });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create pricing rule', error });
    }
};

export const updatePricingRule = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const oldRule = await PricingRule.findById(id);
        const rule = await PricingRule.findByIdAndUpdate(id, req.body, { new: true });

        if (rule) {
            await auditService.logAdminAction({
                countryCode: rule.countryCode,
                adminId: req.user?.userId as string,
                adminRole: req.user?.role as string,
                action: 'PRICING_RULE_UPDATE',
                entityType: 'PricingRule',
                entityId: id,
                beforeState: oldRule?.toObject(),
                afterState: rule.toObject(),
                ipAddress: req.ip,
                systemSource: 'ADMIN_DASHBOARD'
            });
        }

        res.status(200).json({ success: true, rule });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update pricing rule', error });
    }
};

export const deletePricingRule = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        await PricingRule.findByIdAndDelete(id);
        res.status(200).json({ success: true, message: 'Rule deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete pricing rule', error });
    }
};

export const listCommissions = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.user?.countryCode;
        const query: any = {};
        if (countryCode && countryCode !== 'GLOBAL') query.countryCode = countryCode;

        const rules = await CommissionRule.find(query);
        res.status(200).json({ success: true, rules });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to list commissions', error });
    }
};

export const updateCommission = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode, tier, commissionPercentage } = req.body;
        const rule = await CommissionRule.findOneAndUpdate(
            { countryCode, tier },
            { commissionPercentage, isActive: true },
            { new: true, upsert: true }
        );
        res.status(200).json({ success: true, rule });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update commission', error });
    }
};

export const getPriceBotSuggestions = async (req: AuthRequest, res: Response) => {
    try {
        const { countryCode } = req.query;
        const suggestions = await PriceBotSuggestion.find({ countryCode, status: 'PENDING' });
        res.status(200).json({ success: true, suggestions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get PriceBot suggestions', error });
    }
};

export const triggerPriceBot = async (req: AuthRequest, res: Response) => {
    try {
        const countryCode = req.query.countryCode as string || req.user?.countryCode;
        await pricebotService.runPriceBotAnalysis(countryCode as string);
        res.status(200).json({ success: true, message: 'Analysis complete' });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const simulatePricing = async (req: AuthRequest, res: Response) => {
    try {
        const { serviceCode, countryCode, zoneId, isEmergency } = req.query;
        const breakdown = await pricingService.calculateJobPrice(
            serviceCode as string,
            countryCode as string,
            zoneId as string,
            isEmergency === 'true'
        );
        res.status(200).json({ success: true, breakdown });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
