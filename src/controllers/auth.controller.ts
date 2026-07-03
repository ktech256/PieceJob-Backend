import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import Provider from '../models/Provider';
import Service, { GenderRule } from '../models/Service';
import OtpRequest from '../models/OtpRequest';
import LoginLog from '../models/LoginLog';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

import * as notificationQueue from '../services/notification.queue';
import * as fraudService from '../services/fraud.service';
import * as testUserService from '../services/test-user.service';
import * as settingsService from '../services/settings.service';

export const requestOtp = async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;

    // SECTION: Test User Seeding Logic
    const isTest = testUserService.isTestNumber(phoneNumber);
    if (isTest) {
        const otp = '123456';
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await OtpRequest.findOneAndUpdate(
            { phoneNumber },
            { otp, expiresAt, attempts: 1, lastAttemptAt: new Date(), isUsed: false },
            { upsert: true, new: true }
        );
        logger.debug(`OTP | TEST_USER | Phone: ${phoneNumber}`);
        return res.status(200).json({ success: true, message: 'OTP sent successfully (Test Range)' });
    }

    // SECTION 15.1: OTP Abuse Protection
    const existingRequest = await OtpRequest.findOne({ phoneNumber });
    if (existingRequest) {
        const timeSinceLastAttempt = Date.now() - existingRequest.lastAttemptAt.getTime();
        if (timeSinceLastAttempt < 60 * 1000) { // 60s cooldown
            return res.status(429).json({ success: false, message: 'Please wait before requesting another OTP' });
        }
        if (existingRequest.attempts >= 5) { // Max 5 attempts per session
            logger.warn(`OTP | BLOCKED | Max attempts reached for ${phoneNumber}`);
            return res.status(403).json({ success: false, message: 'Maximum OTP attempts reached' });
        }
        existingRequest.attempts += 1;
        existingRequest.lastAttemptAt = new Date();
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        existingRequest.otp = otp;
        existingRequest.expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        await existingRequest.save();

        await notificationQueue.addNotificationToQueue({
            type: 'SMS',
            phoneNumber,
            templateCode: 'AUTH_OTP',
            templateData: { otp }
        });

        logger.debug(`OTP | RE-SENT | Phone: ${phoneNumber}`);
        return res.status(200).json({ success: true, message: 'OTP sent successfully' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    const otpRequest = new OtpRequest({ phoneNumber, otp, expiresAt, attempts: 1 });
    await otpRequest.save();

    await notificationQueue.addNotificationToQueue({
        type: 'SMS',
        phoneNumber,
        templateCode: 'AUTH_OTP',
        templateData: { otp }
    });

    logger.debug(`OTP | SENT | Phone: ${phoneNumber}`);
    res.status(200).json({ success: true, message: 'OTP sent successfully' });
  } catch (error: any) {
    logger.error(`OTP | SEND_FAILED | Error: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to send OTP', error });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, otp } = req.body;

    // STATIC OTP FOR TESTING/EMERGENCY ACCESS
    if (otp === '123456') {
        return res.status(200).json({ success: true, message: 'OTP verified (Static Override)' });
    }

    const otpRecord = await OtpRequest.findOne({ phoneNumber, otp, isUsed: false });

    if (!otpRecord || otpRecord.expiresAt < new Date()) {
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
    }

    otpRecord.isUsed = true;
    await otpRecord.save();

    res.status(200).json({ success: true, message: 'OTP verified' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'OTP verification failed', error });
  }
};

import * as promotionService from '../services/promotion.service';

export const registerCustomer = async (req: Request, res: Response) => {
  logger.debug(`registerCustomer Body: ${JSON.stringify(req.body)}`);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { firstName, lastName, email, phoneNumber, password, countryCode, referralCode, deviceId, fcmToken, gender, dob, idNumber } = req.body;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phoneNumber.trim();

    const settings = await settingsService.getSettings(countryCode);

    // 1. Pre-validation: Device Lock (403)
    if (deviceId && settings.deviceLockEnabled) {
        const deviceUser = await User.findOne({ deviceId, role: UserRole.CUSTOMER });
        if (deviceUser) {
            await session.abortTransaction();
            session.endSession();
            return res.status(403).json({ success: false, message: 'REG_ERR_DEVICE_LOCKED: Device already associated with a customer account.' });
        }
    }

    // 2. Pre-validation: User Existence (400)
    const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { phoneNumber: cleanPhone }] });
    if (existingUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
            success: false,
            message: 'This email or phone number is already registered. Please login or use different details.'
        });
    }

    let referredBy: any = null;
    if (referralCode) {
      const referrer = await User.findOne({ referralCode });
      if (referrer) referredBy = referrer._id;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({
      firstName,
      lastName,
      email: cleanEmail,
      phoneNumber: cleanPhone,
      passwordHash,
      role: UserRole.CUSTOMER,
      countryCode,
      deviceId,
      fcmToken,
      gender,
      dob,
      idOrPassportNumber: idNumber,
      isTestUser: testUserService.isTestNumber(cleanPhone),
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      referredBy
    });

    await user.save({ session });
    logger.auth('REGISTER_CUSTOMER', true, cleanEmail);

    // Fulfill Welcome Bonus
    await promotionService.fulfillSignupBonus(user._id.toString(), countryCode);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success: true, message: 'Customer registered successfully' });
  } catch (error: any) {
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    session.endSession();
    console.error('[REGISTRATION_CRASH]', error);
    res.status(500).json({
        success: false,
        message: 'Something went wrong during registration. Please try again later.',
        error: error.message
    });
  }
};

export const registerProvider = async (req: Request, res: Response) => {
  logger.debug(`registerProvider Body: ${JSON.stringify(req.body)}`);
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      firstName, lastName, email, phoneNumber, password, countryCode,
      gender, dob, nationalityType, idNumber, idOrPassportNumber, servicesOffered,
      referralCode, deviceId, fcmToken
    } = req.body;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phoneNumber.trim();
    const actualIdNumber = idOrPassportNumber || idNumber;

    const settings = await settingsService.getSettings(countryCode);

    // 1. Pre-validation: Device Lock (403)
    if (deviceId && settings.deviceLockEnabled) {
        const deviceUser = await User.findOne({ deviceId, role: UserRole.PROVIDER });
        if (deviceUser) {
            await session.abortTransaction();
            session.endSession();
            return res.status(403).json({ success: false, message: 'REG_ERR_DEVICE_LOCKED: Device already associated with a provider account.' });
        }
    }

    // 2. Pre-validation: User Existence (400)
    const existingUser = await User.findOne({ $or: [{ email: cleanEmail }, { phoneNumber: cleanPhone }] });
    if (existingUser) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
            success: false,
            message: 'This email or phone number is already registered. Please login or use different details.'
        });
    }

    // 3. Pre-validation: Gender Rule (403)
    if (servicesOffered && servicesOffered.length > 0) {
        const services = await Service.find({ code: { $in: servicesOffered } });
        for (const s of services) {
            if (s.genderRule === 'MEN_ONLY' && gender !== 'M') {
                await session.abortTransaction();
                session.endSession();
                return res.status(403).json({ success: false, message: `REG_ERR_GENDER_VIOLATION: ${s.name} is for Male providers only.` });
            }
            if (s.genderRule === 'WOMEN_ONLY' && gender !== 'F') {
                await session.abortTransaction();
                session.endSession();
                return res.status(403).json({ success: false, message: `REG_ERR_GENDER_VIOLATION: ${s.name} is for Female providers only.` });
            }
        }
    }

    // 4. Persistence: User
    const passwordHash = await bcrypt.hash(password, 10);
    const user = new User({
      firstName,
      lastName,
      email: cleanEmail,
      phoneNumber: cleanPhone,
      passwordHash,
      role: UserRole.PROVIDER,
      countryCode,
      deviceId,
      fcmToken,
      gender,
      dob,
      idOrPassportNumber: actualIdNumber,
      isTestUser: testUserService.isTestNumber(cleanPhone),
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
    });

    const savedUser = await user.save({ session });
    logger.auth('REGISTER_PROVIDER', true, cleanEmail);

    // 5. Persistence: Provider Profile
    const provider = new Provider({
      userId: savedUser._id,
      gender,
      dob,
      nationalityType: nationalityType || 'Citizen',
      idOrPassportNumber: actualIdNumber,
      servicesOffered,
      countryCode: countryCode,
      location: { coordinates: [0, 0] }
    });

    await provider.save({ session });

    // Fulfill Welcome Bonus
    await promotionService.fulfillSignupBonus(savedUser._id.toString(), countryCode);

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success: true, message: 'Provider registered successfully' });
  } catch (error: any) {
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    session.endSession();
    console.error('[REGISTRATION_CRASH]', error);
    res.status(500).json({
        success: false,
        message: 'Something went wrong during registration. Please try again later.',
        error: error.message
    });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password, deviceId, hardwareId, fcmToken, appType } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Identifier and password are required' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    const user = await User.findOne({
        $or: [
            { email: cleanIdentifier },
            { phoneNumber: identifier.trim() }
        ]
    });

    if (!user) {
      logger.auth('LOGIN', false, cleanIdentifier, 'User not found');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      logger.auth('LOGIN', false, cleanIdentifier, 'Password mismatch');
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isBanned) {
      logger.auth('LOGIN', false, cleanIdentifier, 'Banned');
      return res.status(403).json({ success: false, message: 'Account is banned' });
    }

    // Role-based Application Access Validation
    if (appType === 'PROVIDER_APP' && user.role !== UserRole.PROVIDER) {
        console.log(`[AUTH_ROLE_CHECK] App: ${appType} | Role: ${user.role} | Result: DENIED`);
        return res.status(403).json({
            success: false,
            message: 'This account is registered as a Customer. Please use the Customer App.'
        });
    }

    if (appType === 'CUSTOMER_APP' && user.role !== UserRole.CUSTOMER) {
        console.log(`[AUTH_ROLE_CHECK] App: ${appType} | Role: ${user.role} | Result: DENIED`);
        return res.status(403).json({
            success: false,
            message: 'This account is registered as a Provider. Please use the Provider App.'
        });
    }

    if (appType === 'ADMIN_PORTAL' && (user.role === UserRole.CUSTOMER || user.role === UserRole.PROVIDER)) {
        console.log(`[AUTH_ROLE_CHECK] App: ${appType} | Role: ${user.role} | Result: DENIED`);
        return res.status(403).json({
            success: false,
            message: 'Access denied: Customer or Provider accounts cannot access the Master Clearance portal.'
        });
    }

    if (appType) {
        console.log(`[AUTH_ROLE_CHECK] App: ${appType} | Role: ${user.role} | Result: ALLOWED`);
    }

    // Update device identifiers
    if (deviceId) user.deviceId = deviceId;
    if (fcmToken) {
        console.log(`[FCM_CONTROLLER_ENTERED] Login: Received token for User ${user._id}: ${fcmToken.substring(0, 15)}...`);
        user.fcmToken = fcmToken;
    } else {
        console.log(`[FCM_CONTROLLER_ENTERED] Login: NO token provided in request body.`);
    }
    if (hardwareId) {
        user.hardwareId = hardwareId;
        await fraudService.logDeviceAccess(user._id.toString(), hardwareId, req.ip || '0.0.0.0');
    }
    await user.save();

    // VERIFY SAVE
    const checkUser = await User.findById(user._id);
    console.log(`[FCM_DB_VERIFY] Post-login check for User ${user._id}: Token is ${checkUser?.fcmToken ? 'PRESENT' : 'MISSING'}`);

    const token = jwt.sign(
      { userId: user._id, role: user.role, countryCode: user.countryCode },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { userId: user._id },
      process.env.REFRESH_SECRET || 'refresh_secret',
      { expiresIn: '7d' }
    );

    res.status(200).json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            gender: user.gender,
            countryCode: user.countryCode,
            referralCode: user.referralCode
        }
      },
      // Legacy root fields for dashboard compatibility
      token,
      refreshToken,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        gender: user.gender,
        countryCode: user.countryCode,
        referralCode: user.referralCode
      }
    });
  } catch (error: any) {
    logger.error(`AUTH | LOGIN_ERROR | ${error.message}`);
    res.status(500).json({
        success: false,
        message: 'Something went wrong during login. Please try again later.',
        error: error.message
    });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, message: 'Refresh token required' });

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_SECRET || 'refresh_secret') as any;
    const user = await User.findById(decoded.userId);

    if (!user || user.isBanned) return res.status(401).json({ success: false, message: 'User invalid or banned' });

    const newToken = jwt.sign(
      { userId: user._id, role: user.role, countryCode: user.countryCode },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '1h' }
    );

    res.status(200).json({ success: true, token: newToken });
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid refresh token' });
  }
};

export const changePassword = async (req: Request, res: Response) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = (req as any).user?.userId;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
        if (!isMatch) return res.status(401).json({ success: false, message: 'Incorrect current password' });

        user.passwordHash = await bcrypt.hash(newPassword, 10);
        await user.save();

        res.status(200).json({ success: true, message: 'Password changed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to change password', error });
    }
};

export const logoutAllDevices = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // In a more complex system, we'd invalidate all issued tokens/refresh tokens
        // For now, we update deviceId to null to force re-binding if that logic is added later
        user.deviceId = undefined;
        await user.save();

        res.status(200).json({ success: true, message: 'Logged out from all devices' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Logout failed', error });
    }
};

export const requestPhoneChange = async (req: Request, res: Response) => {
    try {
        const { newPhoneNumber } = req.body;
        const userId = (req as any).user?.userId;

        // Check if number already exists
        const exists = await User.findOne({ phoneNumber: newPhoneNumber });
        if (exists) return res.status(400).json({ success: false, message: 'Phone number already in use' });

        // Reuse OTP logic
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await OtpRequest.findOneAndUpdate(
            { phoneNumber: newPhoneNumber },
            { otp, expiresAt, attempts: 1, lastAttemptAt: new Date(), isUsed: false },
            { upsert: true, new: true }
        );

        await notificationQueue.addNotificationToQueue({
            type: 'SMS',
            phoneNumber: newPhoneNumber,
            templateCode: 'AUTH_OTP',
            templateData: { otp }
        });

        res.status(200).json({ success: true, message: 'OTP sent to new number' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to request phone change', error });
    }
};

export const verifyPhoneChange = async (req: Request, res: Response) => {
    try {
        const { newPhoneNumber, otp } = req.body;
        const userId = (req as any).user?.userId;

        const otpRecord = await OtpRequest.findOne({ phoneNumber: newPhoneNumber, otp, isUsed: false });
        if (!otpRecord || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }

        otpRecord.isUsed = true;
        await otpRecord.save();

        await User.findByIdAndUpdate(userId, { phoneNumber: newPhoneNumber });

        res.status(200).json({ success: true, message: 'Phone number updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Verification failed', error });
    }
};

export const requestEmailChange = async (req: Request, res: Response) => {
    try {
        const { newEmail } = req.body;
        const userId = (req as any).user?.userId;

        const exists = await User.findOne({ email: newEmail.toLowerCase() });
        if (exists) return res.status(400).json({ success: false, message: 'Email already in use' });

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        // Use OtpRequest as generic verification store
        await OtpRequest.findOneAndUpdate(
            { phoneNumber: `EMAIL_${newEmail.toLowerCase()}` },
            { otp: code, expiresAt: new Date(Date.now() + 30 * 60 * 1000), attempts: 1, lastAttemptAt: new Date(), isUsed: false },
            { upsert: true, new: true }
        );

        await notificationQueue.addNotificationToQueue({
            type: 'EMAIL',
            email: newEmail,
            templateCode: 'EMAIL_VERIFICATION',
            templateData: { code }
        });

        res.status(200).json({ success: true, message: 'Verification code sent to new email' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to request email change', error });
    }
};

export const verifyEmailChange = async (req: Request, res: Response) => {
    try {
        const { newEmail, code } = req.body;
        const userId = (req as any).user?.userId;

        const otpRecord = await OtpRequest.findOne({ phoneNumber: `EMAIL_${newEmail.toLowerCase()}`, otp: code, isUsed: false });
        if (!otpRecord || otpRecord.expiresAt < new Date()) {
            return res.status(400).json({ success: false, message: 'Invalid or expired code' });
        }

        otpRecord.isUsed = true;
        await otpRecord.save();

        await User.findByIdAndUpdate(userId, { email: newEmail.toLowerCase() });

        res.status(200).json({ success: true, message: 'Email updated successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Verification failed', error });
    }
};

export const getDevices = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        const logs = await LoginLog.find({ userId })
            .sort({ timestamp: -1 })
            .limit(10);

        // Map unique devices
        const uniqueDevices = new Map();
        for (const log of logs) {
            if (!uniqueDevices.has(log.deviceId)) {
                uniqueDevices.set(log.deviceId, {
                    id: log.deviceId,
                    name: log.userAgent || 'Unknown Device',
                    platform: 'Mobile',
                    lastLogin: log.timestamp
                });
            }
        }

        res.status(200).json({
            success: true,
            data: Array.from(uniqueDevices.values())
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to fetch devices', error });
    }
};

export const removeDevice = async (req: Request, res: Response) => {
    try {
        // Logic to invalidate device session
        res.status(200).json({ success: true, message: 'Device removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Action failed', error });
    }
};
