import { Request, Response } from 'express';
import Country from '../models/Country';
import SystemSettings from '../models/SystemSettings';
import Service from '../models/Service';
import * as pricingService from '../services/pricing.service';
import * as zoneResolverService from '../services/zone-resolver.service';

export const getWorkspaceConfig = async (req: Request, res: Response) => {
  try {
    const countryCode = req.headers['x-country-code'] as string || 'ZA';

    const country = await Country.findOne({ code: countryCode });
    const settings = await SystemSettings.findOne({ countryCode });

    if (!country) {
        return res.status(404).json({ success: false, message: 'Country configuration not found' });
    }

    res.status(200).json({
      success: true,
      config: {
        country: {
            name: country.name,
            code: country.code,
            currency: country.currency,
            timezone: country.timezone,
            language: country.language,
            locale: country.locale
        },
        settings: {
            matchingRadiusKm: settings?.matchingRadiusKm || 5,
            sosAlertRadiusKm: settings?.sosAlertRadiusKm || 5,
            baseBookingFee: settings?.baseBookingFee || 50,
            referralRewardAmount: settings?.referralRewardAmount || 10,
            bookingFee: settings?.bookingFee || 0,
            platformFee: settings?.platformFee || 0,
            minimumCharge: settings?.minimumCharge || 0,
            taxPercentage: settings?.taxPercentage || 0,
            currencyCode: settings?.currencyCode || 'USD',
            nightFeeEnabled: settings?.nightFeeEnabled || false,
            weekendFeeEnabled: settings?.weekendFeeEnabled || false
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch config', error });
  }
};

export const getPublicServices = async (req: Request, res: Response) => {
    try {
        const countryCode = req.headers['x-country-code'] as string || 'ZA';
        const userGender = req.query.gender as string; // 'M' or 'F'

        const query: any = {
            $or: [{ countryCode: 'GLOBAL' }, { countryCode }],
            isActive: true
        };

        // GENDER FILTERING LOGIC (RC-2 CRITICAL)
        if (userGender) {
            const allowedRules = ['BOTH'];
            if (userGender === 'M') allowedRules.push('MEN_ONLY');
            if (userGender === 'F') allowedRules.push('WOMEN_ONLY');
            query.genderRule = { $in: allowedRules };
        }

        const services = await Service.find(query).sort({ category: 1, code: 1 });

        // RC-2 Dynamic Grouping logic
        const grouped: any = {
            'STANDARD': { label: 'STANDARD', requirements: '(ID, Selfie)', services: [] },
            'PROFESSIONAL': { label: 'PROFESSIONAL', requirements: '(ID, Selfie, Certification, Experience)', services: [] },
            'TRADE': { label: 'TRADE', requirements: '(ID, Selfie, Trade Licence, Tool Verification)', services: [] },
            'HIGH_VETTING': { label: 'HIGH VETTING', requirements: '(ID, Selfie, References, Interview)', services: [] }
        };

        for (const s of services) {
            let level: string = s.verificationLevel;
            // SPEC Category Mappings
            if (s.category === ServiceCategory.CSS) level = VerificationLevel.HIGH_VETTING;
            if ([ServiceCategory.HMS, ServiceCategory.OPS, ServiceCategory.TSS].includes(s.category)) {
                if (level !== VerificationLevel.HIGH_VETTING) level = VerificationLevel.TRADE;
            }
            if (grouped[level]) grouped[level].services.push(s);
            else grouped['STANDARD'].services.push(s);
        }

        res.status(200).json({
            success: true,
            data: services,
            services: services, // Dual key
            grouped: Object.values(grouped).filter((g: any) => g.services.length > 0)
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch services', error });
    }
};

export const getPriceEstimate = async (req: Request, res: Response) => {
    try {
        const { serviceCode, zoneId, isEmergency } = req.query;
        const countryCode = req.headers['x-country-code'] as string || 'ZA';

        const estimate = await pricingService.calculateJobPrice(
            serviceCode as string,
            countryCode,
            zoneId as string,
            isEmergency === 'true'
        );

        res.status(200).json({ success: true, data: estimate });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const resolveZone = async (req: Request, res: Response) => {
    try {
        const { lat, lng } = req.query;
        const countryCode = req.headers['x-country-code'] as string || 'ZA';

        const zone = await zoneResolverService.resolveZoneForLocation(
            [parseFloat(lng as string), parseFloat(lat as string)],
            countryCode
        );

        res.status(200).json({ success: true, data: zone });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getCountries = async (req: Request, res: Response) => {
    try {
        const countries = await Country.find({ isActive: true }).sort({ name: 1 });
        console.log(`[API] Returning ${countries.length} countries to client`);
        res.status(200).json({
            success: true,
            data: countries,
            countries: countries // Keep legacy key for dashboard compatibility
        });
    } catch (error) {
        console.error('[API] Error fetching countries:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch countries', error });
    }
};

export const getLanguages = async (req: Request, res: Response) => {
    try {
        const languages = [
            { code: 'en', name: 'English' },
            { code: 'af', name: 'Afrikaans' },
            { code: 'zu', name: 'Zulu' },
            { code: 'xh', name: 'Xhosa' },
            { code: 'tn', name: 'Tswana' },
            { code: 'fr', name: 'French' },
            { code: 'pt', name: 'Portuguese' }
        ];
        res.status(200).json({
            success: true,
            data: languages,
            languages: languages // Keep legacy key
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch languages', error });
    }
};
