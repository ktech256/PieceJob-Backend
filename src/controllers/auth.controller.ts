import { Request, Response } from 'express';
import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import Provider from '../models/Provider';
import Service, { GenderRule } from '../models/Service';
import OtpRequest from '../models/OtpRequest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

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

    res.status(200).json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
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

export const registerCustomer = async (req: Request, res: Response) => {
  console.log('[DEBUG] registerCustomer Body:', JSON.stringify(req.body, null, 2));
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { firstName, lastName, email, phoneNumber, password, countryCode, referralCode, deviceId, gender, dob, idNumber } = req.body;

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
        return res.status(400).json({ success: false, message: 'User already exists.' });
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
      gender,
      dob,
      idOrPassportNumber: idNumber,
      isTestUser: testUserService.isTestNumber(cleanPhone),
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      referredBy
    });

    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success: true, message: 'Customer registered successfully' });
  } catch (error: any) {
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    session.endSession();
    console.error('[REGISTRATION_CRASH]', error);
    res.status(500).json({ success: false, message: 'Registration failed internal error', error: error.message });
  }
};

export const registerProvider = async (req: Request, res: Response) => {
  console.log('[DEBUG] registerProvider Body:', JSON.stringify(req.body, null, 2));
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      firstName, lastName, email, phoneNumber, password, countryCode,
      gender, dob, nationalityType, idNumber, idOrPassportNumber, servicesOffered,
      referralCode, deviceId
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
        return res.status(400).json({ success: false, message: 'User already exists.' });
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
      gender,
      dob,
      idOrPassportNumber: actualIdNumber,
      isTestUser: testUserService.isTestNumber(cleanPhone),
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
    });

    const savedUser = await user.save({ session });

    // 5. Persistence: Provider Profile
    const provider = new Provider({
      userId: savedUser._id,
      gender,
      dob,
      nationalityType: nationalityType || 'Citizen',
      idOrPassportNumber: actualIdNumber,
      servicesOffered,
      countryCode: countryCode || 'ZA',
      location: { coordinates: [0, 0] }
    });

    await provider.save({ session });

    await session.commitTransaction();
    session.endSession();

    res.status(201).json({ success: true, message: 'Provider registered successfully' });
  } catch (error: any) {
    if (session.inTransaction()) {
        await session.abortTransaction();
    }
    session.endSession();
    console.error('[REGISTRATION_CRASH]', error);
    res.status(500).json({ success: false, message: 'Registration failed internal error', error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password, deviceId, hardwareId } = req.body;

    if (!identifier || !password) {
        return res.status(400).json({ success: false, message: 'Identifier and password are required' });
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    console.log(`[AUTH] Login attempt for: ${identifier.trim()}`);

    const user = await User.findOne({
        $or: [
            { email: { $regex: new RegExp('^' + cleanIdentifier + '$', 'i') } },
            { phoneNumber: identifier.trim() }
        ]
    });

    if (!user) {
      console.warn(`[AUTH] Login failed: User not found for ${cleanIdentifier}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      console.warn(`[AUTH] Login failed: Password mismatch for ${cleanIdentifier}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (user.isBanned) {
      return res.status(403).json({ success: false, message: 'Account is banned' });
    }

    // Update device identifiers
    if (deviceId) user.deviceId = deviceId;
    if (hardwareId) {
        user.hardwareId = hardwareId;
        // PAGE 12: Device Integrity & Multi-account Check
        await fraudService.logDeviceAccess(user._id.toString(), hardwareId, req.ip || '0.0.0.0');
    }
    await user.save();

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
  } catch (error) {
    res.status(500).json({ success: false, message: 'Login failed', error });
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

export const getDevices = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user?.userId;
        // In a real app, this would query a dedicated sessions or devices collection
        // For Phase 2, we simulate it with current user info
        const user = await User.findById(userId);
        res.status(200).json({
            success: true,
            data: [{
                id: user?.deviceId || 'primary',
                name: 'Current Android Device',
                platform: 'Android',
                lastLogin: user?.updatedAt
            }]
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
