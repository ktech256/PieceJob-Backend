import { Request, Response } from 'express';
import User, { UserRole } from '../models/User';
import Provider from '../models/Provider';
import OtpRequest from '../models/OtpRequest';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

export const requestOtp = async (req: Request, res: Response) => {
  try {
    const { phoneNumber } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit OTP
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins expiry

    await OtpRequest.deleteMany({ phoneNumber }); // Clear previous
    const otpRequest = new OtpRequest({ phoneNumber, otp, expiresAt });
    await otpRequest.save();

    console.log(`OTP for ${phoneNumber}: ${otp}`); // Placeholder for SMS provider

    res.status(200).json({ success: true, message: 'OTP sent successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to send OTP', error });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, otp } = req.body;
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
    const { firstName, lastName, email, phoneNumber, password, countryCode, referralCode, deviceId } = req.body;

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
      gender, dob, nationalityType, idOrPassportNumber, servicesOffered,
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
      referralCode: Math.random().toString(36).substring(2, 8).toUpperCase(),
      referredBy
    });

    const savedUser = await user.save();

    const provider = new Provider({
      userId: savedUser._id,
      gender,
      dob,
      nationalityType,
      idOrPassportNumber,
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
    const { identifier, password, deviceId } = req.body; // identifier can be email or phone

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

    // Update deviceId for binding
    if (deviceId) {
      user.deviceId = deviceId;
      await user.save();
    }

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
      token,
      refreshToken,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
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
