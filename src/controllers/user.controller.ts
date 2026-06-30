import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User';
import * as auditService from '../services/audit.service';
import * as storageService from '../services/storage.service';
import { logger } from '../utils/logger';

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.user?.userId).select('-passwordHash');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const userData = user.toObject();
    if (userData.profilePhoto) {
        userData.profilePhoto = await storageService.getSignedUrl(userData.profilePhoto);
    }
    if (userData.pendingAddress?.proofOfResidenceUrl) {
        userData.pendingAddress.proofOfResidenceUrl = await storageService.getSignedUrl(userData.pendingAddress.proofOfResidenceUrl);
    }

    res.status(200).json({ success: true, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile', error });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, email, gender, dob, profilePhoto } = req.body;
    const oldUser = await User.findById(req.user?.userId);
    const user = await User.findByIdAndUpdate(
      req.user?.userId,
      { firstName, lastName, email, gender, dob, profilePhoto },
      { new: true }
    ).select('-passwordHash');

    if (user && oldUser) {
        await auditService.logUserModification({
            countryCode: user.countryCode,
            userId: user.id,
            action: 'PROFILE_UPDATE',
            modificationType: 'Personal Info',
            beforeState: { firstName: oldUser.firstName, lastName: oldUser.lastName, email: oldUser.email, gender: oldUser.gender, dob: oldUser.dob },
            afterState: { firstName: user.firstName, lastName: user.lastName, email: user.email, gender: user.gender, dob: user.dob },
            triggeredBy: 'USER',
            ipAddress: req.ip,
            systemSource: 'API'
        });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Update failed', error });
  }
};

// --- ADDRESSES ---
export const getAddresses = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId).select('addresses');
        const addresses = user?.addresses || [];
        // Sort by usageCount descending
        addresses.sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0));
        res.status(200).json({ success: true, data: addresses });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch addresses', error });
    }
};

export const addAddress = async (req: AuthRequest, res: Response) => {
    try {
        const { label, address, coordinates, isDefault } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (isDefault) {
            user.addresses?.forEach(a => a.isDefault = false);
        }

        user.addresses?.push({ label, address, coordinates, isDefault });
        await user.save();

        res.status(201).json({ success: true, data: user.addresses });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add address', error });
    }
};

export const updateAddress = async (req: AuthRequest, res: Response) => {
    try {
        const { addressId } = req.params;
        const { label, address, coordinates, isDefault } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const addr = (user.addresses as any).id(addressId);
        if (!addr) return res.status(404).json({ success: false, message: 'Address not found' });

        if (isDefault) {
            user.addresses?.forEach(a => a.isDefault = false);
        }

        addr.label = label || addr.label;
        addr.address = address || addr.address;
        addr.coordinates = coordinates || addr.coordinates;
        addr.isDefault = isDefault !== undefined ? isDefault : addr.isDefault;

        await user.save();
        res.status(200).json({ success: true, data: user.addresses });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update address', error });
    }
};

export const deleteAddress = async (req: AuthRequest, res: Response) => {
    try {
        const { addressId } = req.params;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.addresses = user.addresses?.filter(a => (a as any)._id.toString() !== addressId);
        await user.save();

        res.status(200).json({ success: true, data: user.addresses });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete address', error });
    }
};

// --- SAVED LOCATIONS ---
export const getSavedLocations = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId).select('savedLocations');
        const locations = user?.savedLocations || [];
        // Sort by lastUsedAt descending
        locations.sort((a, b) => (b.lastUsedAt?.getTime() || 0) - (a.lastUsedAt?.getTime() || 0));
        res.status(200).json({ success: true, data: locations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch saved locations', error });
    }
};

export const addSavedLocation = async (req: AuthRequest, res: Response) => {
    try {
        const { name, address, coordinates } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.savedLocations?.push({ name, address, coordinates });
        await user.save();

        res.status(201).json({ success: true, data: user.savedLocations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add saved location', error });
    }
};

export const updateSavedLocation = async (req: AuthRequest, res: Response) => {
    try {
        const { locationId } = req.params;
        const { name, address, coordinates } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const loc = (user.savedLocations as any).id(locationId);
        if (!loc) return res.status(404).json({ success: false, message: 'Location not found' });

        loc.name = name || loc.name;
        loc.address = address || loc.address;
        loc.coordinates = coordinates || loc.coordinates;

        await user.save();
        res.status(200).json({ success: true, data: user.savedLocations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update location', error });
    }
};

export const deleteSavedLocation = async (req: AuthRequest, res: Response) => {
    try {
        const { locationId } = req.params;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.savedLocations = user.savedLocations?.filter(l => (l as any)._id.toString() !== locationId);
        await user.save();

        res.status(200).json({ success: true, data: user.savedLocations });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete location', error });
    }
};

// --- PAYMENT METHODS ---
export const getPaymentMethods = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId).select('paymentMethods');
        res.status(200).json({ success: true, data: user?.paymentMethods || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch payment methods', error });
    }
};

export const addPaymentMethod = async (req: AuthRequest, res: Response) => {
    try {
        const { brand, last4, expMonth, expYear, token, isDefault } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if (isDefault) {
            user.paymentMethods?.forEach(m => m.isDefault = false);
        }

        user.paymentMethods?.push({ brand, last4, expMonth, expYear, token, isDefault });
        await user.save();

        res.status(201).json({ success: true, data: user.paymentMethods });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add payment method', error });
    }
};

export const deletePaymentMethod = async (req: AuthRequest, res: Response) => {
    try {
        const { cardId } = req.params;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.paymentMethods = user.paymentMethods?.filter(m => (m as any)._id.toString() !== cardId);
        await user.save();

        res.status(200).json({ success: true, data: user.paymentMethods });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete payment method', error });
    }
};

// --- EMERGENCY CONTACTS ---
export const getEmergencyContacts = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId).select('emergencyContacts');
        res.status(200).json({ success: true, data: user?.emergencyContacts || [] });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch emergency contacts', error });
    }
};

export const addEmergencyContact = async (req: AuthRequest, res: Response) => {
    try {
        const { name, phone, relationship } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        if ((user.emergencyContacts?.length || 0) >= 5) {
            return res.status(400).json({ success: false, message: 'Maximum 5 emergency contacts allowed' });
        }

        user.emergencyContacts?.push({ name, phone, relationship });
        await user.save();

        res.status(201).json({ success: true, data: user.emergencyContacts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add emergency contact', error });
    }
};

export const updateEmergencyContact = async (req: AuthRequest, res: Response) => {
    try {
        const { contactId } = req.params;
        const { name, phone, relationship } = req.body;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const contact = (user.emergencyContacts as any).id(contactId);
        if (!contact) return res.status(404).json({ success: false, message: 'Contact not found' });

        contact.name = name || contact.name;
        contact.phone = phone || contact.phone;
        contact.relationship = relationship || contact.relationship;

        await user.save();
        res.status(200).json({ success: true, data: user.emergencyContacts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update emergency contact', error });
    }
};

export const deleteEmergencyContact = async (req: AuthRequest, res: Response) => {
    try {
        const { contactId } = req.params;
        const user = await User.findById(req.user?.userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        user.emergencyContacts = user.emergencyContacts?.filter(c => (c as any)._id.toString() !== contactId);
        await user.save();

        res.status(200).json({ success: true, data: user.emergencyContacts });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete emergency contact', error });
    }
};

// --- PREFERENCES & SETTINGS ---
export const updatePreferences = async (req: AuthRequest, res: Response) => {
    try {
        const { language, country } = req.body;
        const user = await User.findByIdAndUpdate(
            req.user?.userId,
            { language, country },
            { new: true }
        ).select('language country');
        res.status(200).json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};

export const updatePrivacySettings = async (req: AuthRequest, res: Response) => {
    try {
        const { profileVisibility, shareLocation, dataSharing, marketingPreferences } = req.body;
        const user = await User.findByIdAndUpdate(
            req.user?.userId,
            { privacySettings: { profileVisibility, shareLocation, dataSharing, marketingPreferences } },
            { new: true }
        ).select('privacySettings');
        res.status(200).json({ success: true, data: user?.privacySettings });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Update failed', error });
    }
};

// --- SUBSCRIPTION (PieceJob Plus) ---
export const getSubscription = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId).select('subscription');
        res.status(200).json({ success: true, data: user?.subscription });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch subscription', error });
    }
};

export const upgradeSubscription = async (req: AuthRequest, res: Response) => {
    try {
        const { plan } = req.body; // e.g. PLUS
        const expiryDate = new Date();
        expiryDate.setMonth(expiryDate.getMonth() + 1); // 1 month plan for now

        const user = await User.findByIdAndUpdate(
            req.user?.userId,
            { subscription: { plan, status: 'ACTIVE', startDate: new Date(), expiryDate } },
            { new: true }
        ).select('subscription');

        res.status(200).json({ success: true, message: `Upgraded to ${plan} successfully`, data: user?.subscription });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Upgrade failed', error });
    }
};

export const cancelSubscription = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user?.userId);
        if (user && user.subscription) {
            user.subscription.status = 'CANCELLED';
            await user.save();
        }
        res.status(200).json({ success: true, message: 'Subscription cancelled', data: user?.subscription });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Cancellation failed', error });
    }
};

export const updateFcmToken = async (req: AuthRequest, res: Response) => {
  try {
    const { fcmToken } = req.body;
    const userId = req.user?.userId;

    console.log(`[FCM_CONTROLLER_ENTERED] User: ${userId}`);
    console.log(`[FCM_CONTROLLER_ENTERED] Received token: ${fcmToken || 'NULL'}`);

    if (!fcmToken) {
        console.warn(`[FCM_CONTROLLER_ENTERED] WARN: Received NULL/EMPTY token for User ${userId}. Ignoring.`);
        return res.status(200).json({ success: true, message: 'Empty token ignored' });
    }

    console.log(`[FCM_DB_VERIFY] Attempting MongoDB update for User ${userId}`);
    const result = await User.updateOne({ _id: userId }, { fcmToken });
    console.log(`[FCM_DB_VERIFY] Update Result: Matched=${result.matchedCount}, Modified=${result.modifiedCount}`);

    // Read again to confirm save
    const updatedUser = await User.findById(userId);
    console.log(`[FCM_DB_VERIFY] Stored token: ${updatedUser?.fcmToken || 'NULL'}`);

    if (updatedUser && updatedUser.fcmToken === fcmToken) {
        console.log(`[FCM_DB_VERIFY] Mongo Save Success for User ${userId}`);
    } else {
        console.error(`[FCM_DB_VERIFY] ERROR: Mismatch! Found ${updatedUser?.fcmToken ? 'DIFFERENT' : 'NULL'} token in DB.`);
    }

    res.status(200).json({ success: true, message: 'FCM token updated' });
  } catch (error: any) {
    console.error(`[FCM_TOKEN_AUDIT] FATAL ERROR for User ${req.user?.userId}:`, error.message);
    res.status(500).json({ success: false, message: 'Failed to update FCM token', error });
  }
};

export const getReferralStats = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.userId;
        const user = await User.findById(userId);

        const referrals = await User.find({ referredBy: userId }).select('firstName lastName createdAt isVerified');

        res.status(200).json({
            success: true,
            data: {
                referralCode: user?.referralCode,
                totalReferrals: referrals.length,
                pendingRewards: 0, // Logic for pending
                paidRewards: 0, // Logic for paid
                history: referrals
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch referral stats', error });
    }
};
