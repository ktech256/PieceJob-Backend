import { Request, Response } from 'express';
import Country from '../models/Country';
import SystemSettings from '../models/SystemSettings';
import Service, { ServiceCategory, VerificationLevel } from '../models/Service';
import ServiceCategoryModel from '../models/ServiceCategory';
import Provider from '../models/Provider';
import * as pricingService from '../services/pricing.service';
import * as zoneResolverService from '../services/zone-resolver.service';
import { logger } from '../utils/logger';

export const getWorkspaceConfig = async (req: Request, res: Response) => {
  try {
    const countryCode = req.headers['x-country-code'] as string;

    if (!countryCode) {
        return res.status(400).json({ success: false, message: 'x-country-code header required.' });
    }

    const [country, settings] = await Promise.all([
        Country.findOne({ code: countryCode }),
        SystemSettings.findOne({ countryCode })
    ]);

    if (!country) {
        return res.status(404).json({ success: false, message: `Country configuration for '${countryCode}' not found.` });
    }

    res.status(200).json({
      success: true,
      data: {
        country: {
            name: country.name,
            code: country.code,
            currency: country.currency,
            currencySymbol: country.currencySymbol,
            timezone: country.timezone,
            language: country.language,
            locale: country.locale,
            flagEmoji: country.flagEmoji
        },
        settings: {
            matchingRadiusKm: settings?.matchingRadiusKm || 5,
            sosAlertRadiusKm: settings?.sosAlertRadiusKm || 5,
            baseBookingFee: settings?.baseBookingFee || 0,
            referralRewardAmount: settings?.referralRewardAmount || 10,
            bookingFee: settings?.bookingFee || 0,
            platformFee: settings?.platformFee || 0,
            minimumCharge: settings?.minimumCharge || 0,
            taxPercentage: settings?.taxPercentage || 0,
            currencyCode: country.currency,
            currencySymbol: country.currencySymbol || country.currency,
            nightFeeEnabled: settings?.nightFeeEnabled || false,
            weekendFeeEnabled: settings?.weekendFeeEnabled || false
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch config', error });
  }
};

export const getPublicCategories = async (req: Request, res: Response) => {
    try {
        const categories = await ServiceCategoryModel.find({ isDeleted: false, isActive: true }).sort({ sortOrder: 1 });
        res.status(200).json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch categories', error });
    }
};

export const getPublicServices = async (req: Request, res: Response) => {
    try {
        const countryCode = req.headers['x-country-code'] as string;
        if (!countryCode) return res.status(400).json({ success: false, message: 'x-country-code header required' });

        const userGender = req.query.gender as string; // 'M' or 'F'
        const lat = req.query.lat ? parseFloat(req.query.lat as string) : null;
        const lng = req.query.lng ? parseFloat(req.query.lng as string) : null;

        const settings = await SystemSettings.findOne({ countryCode });
        const radiusKm = settings?.matchingRadiusKm || 5;

        const query: any = {
            $or: [{ countryCode: 'GLOBAL' }, { countryCode }],
            isActive: true
        };

        if (userGender) {
            const allowedRules = ['BOTH'];
            if (userGender === 'M') allowedRules.push('MEN_ONLY');
            if (userGender === 'F') allowedRules.push('WOMEN_ONLY');
            query.genderRule = { $in: allowedRules };
        }

        const allServices = await Service.find(query).sort({ code: 1, countryCode: -1 });

        // Deduplicate services by code, preferring country-specific over GLOBAL
        const serviceMap = new Map();
        allServices.forEach(s => {
            if (!serviceMap.has(s.code)) {
                serviceMap.set(s.code, s);
            }
        });
        const services = Array.from(serviceMap.values());

        const categories = await ServiceCategoryModel.find({ isDeleted: false, isActive: true }).sort({ sortOrder: 1 });

        const providerQuery: any = {
            countryCode,
            isOnline: true,
            currentAvailabilityStatus: 'ONLINE',
            verificationStatus: 'APPROVED'
        };

        if (lat !== null && lng !== null) {
            providerQuery.location = {
                $near: {
                    $geometry: { type: 'Point', coordinates: [lng, lat] },
                    $maxDistance: radiusKm * 1000
                }
            };
        }

        const onlineProviders = await Provider.find(providerQuery).select('servicesOffered location');

        const formatCountLabel = (count: number) => {
            if (count === 0) return "0 Online";
            if (count === 1) return "1 Online";
            if (count > 1 && count < 5) return "0-4 Online";
            if (count >= 5 && count < 10) return "5+ Online";
            if (count >= 10) return "10+ Online";
            return "0 Online";
        };

        const servicesWithCounts = services.map((s: any) => {
            const count = onlineProviders.filter((p: any) => p.servicesOffered.includes(s.code)).length;
            const sObj = s.toObject ? s.toObject() : s;
            return {
                ...sObj,
                onlineCountLabel: formatCountLabel(count),
                onlineCount: count
            };
        });

        const grouped = categories.map((cat: any) => {
            const servicesInCategory = servicesWithCounts.filter((s: any) => s.category === cat.code);

            return {
                label: cat.name,
                requirements: `Various levels based on service selection`,
                services: servicesInCategory
            };
        }).filter(g => g.services.length > 0);

        res.status(200).json({
            success: true,
            data: {
                services: servicesWithCounts,
                grouped: grouped
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch services', error });
    }
};

export const getPriceEstimate = async (req: Request, res: Response) => {
    try {
        const { serviceCode, zoneId, isEmergency } = req.query;
        const countryCode = req.headers['x-country-code'] as string;
        if (!countryCode) return res.status(400).json({ success: false, message: 'x-country-code header required' });

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
        const countryCode = req.headers['x-country-code'] as string;
        if (!countryCode) return res.status(400).json({ success: false, message: 'x-country-code header required' });

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
        res.status(200).json({
            success: true,
            data: countries,
            countries: countries
        });
    } catch (error) {
        logger.error(`CONFIG | FETCH_COUNTRIES_FAILED | Error: ${error}`);
        res.status(500).json({ success: false, message: 'Failed to fetch countries', error });
    }
};

export const getLanguages = async (req: Request, res: Response) => {
    try {
        // Return supported system languages
        const languages = [
            { code: 'en', name: 'English' },
            { code: 'zu', name: 'isiZulu' },
            { code: 'xh', name: 'isiXhosa' },
            { code: 'af', name: 'Afrikaans' }
        ];
        res.status(200).json({ success: true, data: languages });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch languages' });
    }
};

export const globalSearch = async (req: Request, res: Response) => {
    try {
        const query = req.query.q as string;
        const countryCode = req.headers['x-country-code'] as string;

        if (!query || query.length < 2) {
            return res.status(200).json({ success: true, data: [] });
        }

        // 1. Search Services (Isolated by Workspace)
        const services = await Service.find({
            $or: [
                { name: { $regex: query, $options: 'i' } },
                { description: { $regex: query, $options: 'i' } }
            ],
            countryCode: { $in: ['GLOBAL', countryCode] },
            isActive: true
        }).sort({ countryCode: -1 }).limit(10);

        // Deduplicate services by code
        const serviceMap = new Map();
        services.forEach(s => {
            if (!serviceMap.has(s.code)) {
                serviceMap.set(s.code, s);
            }
        });
        const dedupedServices = Array.from(serviceMap.values());

        // 2. Search Categories
        const categories = await ServiceCategoryModel.find({
            name: { $regex: query, $options: 'i' },
            isActive: true
        }).limit(5);

        // 3. Search Providers
        const providers = await Provider.find({
            countryCode,
            isOnline: true,
            verificationStatus: 'APPROVED'
        }).populate({
            path: 'userId',
            match: {
                $or: [
                    { firstName: { $regex: query, $options: 'i' } },
                    { lastName: { $regex: query, $options: 'i' } }
                ]
            },
            select: 'firstName lastName profilePhoto'
        }).limit(10);

        const foundProviders = providers.filter(p => p.userId !== null);

        res.status(200).json({
            success: true,
            data: {
                services: dedupedServices,
                categories,
                providers: foundProviders.map(p => {
                    const u = p.userId as any;
                    return {
                        id: p._id,
                        name: `${u.firstName} ${u.lastName}`,
                        photo: u.profilePhoto,
                        rating: p.ratingAvg,
                        services: p.servicesOffered
                    };
                })
            }
        });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};
