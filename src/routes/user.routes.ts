import { Router } from 'express';
import * as userController from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/profile', authenticate, userController.getProfile);
router.put('/profile', authenticate, userController.updateProfile);
router.get('/referrals', authenticate, userController.getReferralStats);
router.patch('/fcm-token', authenticate, userController.updateFcmToken);

// Addresses
router.get('/addresses', authenticate, userController.getAddresses);
router.post('/addresses', authenticate, userController.addAddress);
router.put('/addresses/:addressId', authenticate, userController.updateAddress);
router.delete('/addresses/:addressId', authenticate, userController.deleteAddress);

// Saved Locations
router.get('/saved-locations', authenticate, userController.getSavedLocations);
router.post('/saved-locations', authenticate, userController.addSavedLocation);
router.put('/saved-locations/:locationId', authenticate, userController.updateSavedLocation);
router.delete('/saved-locations/:locationId', authenticate, userController.deleteSavedLocation);

// Payment Methods
router.get('/payment-methods', authenticate, userController.getPaymentMethods);
router.post('/payment-methods', authenticate, userController.addPaymentMethod);
router.delete('/payment-methods/:cardId', authenticate, userController.deletePaymentMethod);

// Emergency Contacts
router.get('/emergency-contacts', authenticate, userController.getEmergencyContacts);
router.post('/emergency-contacts', authenticate, userController.addEmergencyContact);
router.put('/emergency-contacts/:contactId', authenticate, userController.updateEmergencyContact);
router.delete('/emergency-contacts/:contactId', authenticate, userController.deleteEmergencyContact);

// Preferences & Privacy
router.patch('/preferences', authenticate, userController.updatePreferences);
router.patch('/privacy', authenticate, userController.updatePrivacySettings);

// Subscription
router.get('/subscription', authenticate, userController.getSubscription);
router.post('/subscription/upgrade', authenticate, userController.upgradeSubscription);
router.post('/subscription/cancel', authenticate, userController.cancelSubscription);

export default router;
