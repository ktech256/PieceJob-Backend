import { Request, Response } from 'express';
import User, { UserRole } from '../models/User';
import Provider from '../models/Provider';
import OtpRequest from '../models/OtpRequest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

import * as notificationQueue from '../services/notification.queue';
import * as fraudService from '../services/fraud.service';
import * as testUserService from '../services/test-user.service';

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
  try {
    const { firstName, lastName, email, phoneNumber, password, countryCode, referralCode, deviceId, gender, dob, idNumber } = req.body;

    // SECTION 15.1: Referral Abuse Prevention - Device Uniqueness
    if (deviceId) {
        const deviceUser = await User.findOne({ deviceId, role: UserRole.CUSTOMER });
        if (deviceUser) {
            return res.status(403).json({ success: false, message: 'Device already associated with an account' });
        }
    }

    const existingUser = await User.findOne({ $or: [{ email }, { phoneNumber }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
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
      email,
      phoneNumber,
      passwordHash,
      role: UserRole.CUSTOMER,
      countryCode,
      deviceId,
      gender,
      dob,
      idOrPassportNumber: idNumber,
      isTestUser: testUserService.isTestNumber(phoneNumber),
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      referredBy
    });

    await user.save();

    res.status(201).json({ success: true, message: 'Customer registered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Registration failed', error });
  }
};

export const registerProvider = async (req: Request, res: Response) => {
  try {
    const {
      firstName, lastName, email, phoneNumber, password, countryCode,
      gender, dob, nationalityType, idNumber, servicesOffered,
      referralCode, deviceId
    } = req.body;

    // SECTION 15.1: Device Uniqueness for Providers
    if (deviceId) {
        const deviceUser = await User.findOne({ deviceId, role: UserRole.PROVIDER });
        if (deviceUser) {
            return res.status(403).json({ success: false, message: 'Device already associated with an account' });
        }
    }

    const existingUser = await User.findOne({ $or: [{ email }, { phoneNumber }] });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User already exists' });
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
      email,
      phoneNumber,
      passwordHash,
      role: UserRole.PROVIDER,
      countryCode,
      deviceId,
      gender,
      dob,
      idOrPassportNumber: idNumber,
      isTestUser: testUserService.isTestNumber(phoneNumber),
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      referredBy
    });

    const savedUser = await user.save();

    // SECTION: Gender Rule Enforcement for Selected Services
    if (servicesOffered && servicesOffered.length > 0) {
        const services = await Service.find({ code: { $in: servicesOffered } });
        for (const s of services) {
            if (s.genderRule === GenderRule.MEN_ONLY && gender !== 'M') {
                return res.status(403).json({ success: false, message: `Service ${s.name} is restricted to Male providers.` });
            }
            if (s.genderRule === GenderRule.WOMEN_ONLY && gender !== 'F') {
                return res.status(403).json({ success: false, message: `Service ${s.name} is restricted to Female providers.` });
            }
        }
    }

    const provider = new Provider({
      userId: savedUser._id,
      gender,
      dob,
      nationalityType,
      idOrPassportNumber: idNumber,
      servicesOffered,
      location: { coordinates: [0, 0] } // Initial location
    });

    await provider.save();

    res.status(201).json({ success: true, message: 'Provider registered successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Registration failed', error });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { identifier, password, deviceId, hardwareId } = req.body; // identifier can be email or phone

    const user = await User.findOne({ $or: [{ email: identifier }, { phoneNumber: identifier }] });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
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
