import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import EmailConfig from '../../models/EmailConfig';
import EmailLog from '../../models/EmailLog';
import NotificationTemplate from '../../models/NotificationTemplate';
import * as emailService from '../../services/email.service';
import mongoose from 'mongoose';

export const getEmailConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    let config = await EmailConfig.findOne({ countryCode: countryCode as string });

    if (!config) {
        // Create default config if not found
        config = new EmailConfig({ countryCode });
        await config.save();
    }

    res.status(200).json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateEmailConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const config = await EmailConfig.findOneAndUpdate(
      { countryCode: countryCode as string },
      { $set: req.body },
      { new: true, upsert: true }
    );
    res.status(200).json({ success: true, data: config });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const listTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode, channel = 'EMAIL' } = req.query;
    const templates = await NotificationTemplate.find({
      channel,
      $or: [{ countryCode: countryCode as string }, { countryCode: 'GLOBAL' }]
    }).sort({ templateCode: 1 });
    res.status(200).json({ success: true, data: templates });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTemplateDetails = async (req: AuthRequest, res: Response) => {
  try {
    const template = await NotificationTemplate.findById(req.params.id);
    res.status(200).json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const template = new NotificationTemplate({
      ...req.body,
      createdBy: req.user?.userId,
      updatedBy: req.user?.userId
    });
    await template.save();
    res.status(201).json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const template = await NotificationTemplate.findByIdAndUpdate(
      req.params.id,
      {
        $set: req.body,
        updatedBy: req.user?.userId,
        $inc: { version: 1 }
      },
      { new: true }
    );
    res.status(200).json({ success: true, data: template });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const previewTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const template = await NotificationTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

    // Mock data for preview
    const mockData: Record<string, string> = {};
    template.placeholders.forEach(p => {
        mockData[p] = `[${p}]`;
    });

    // We can't easily preview HTML here without a full render,
    // so we'll just return the resolved body
    let body = template.body;
    let text = template.plainTextBody || '';
    let subject = template.subject || '';

    Object.entries(mockData).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      const regex = new RegExp(placeholder, 'g');
      body = body.replace(regex, value);
      if (text) text = text.replace(regex, value);
      subject = subject.replace(regex, value);
    });

    res.status(200).json({ success: true, preview: { html: body, text, subject } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const duplicateTemplate = async (req: AuthRequest, res: Response) => {
    try {
        const original = await NotificationTemplate.findById(req.params.id);
        if (!original) return res.status(404).json({ success: false, message: 'Original template not found' });

        const copy = new NotificationTemplate({
            ...original.toObject(),
            _id: new mongoose.Types.ObjectId(),
            templateCode: `${original.templateCode}_COPY`,
            active: false,
            version: 1,
            createdBy: req.user?.userId,
            updatedBy: req.user?.userId
        });

        await copy.save();
        res.status(201).json({ success: true, data: copy });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const archiveTemplate = async (req: AuthRequest, res: Response) => {
    try {
        const template = await NotificationTemplate.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
        res.status(200).json({ success: true, data: template });
    } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const getEmailLogs = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode, page = 1, limit = 50, category } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const query: any = { countryCode: countryCode as string };
    if (category && category !== 'ALL') {
        // We need to match template category. Since logs only have templateCode,
        // we might need to join or find all templates in that category first.
        const templates = await NotificationTemplate.find({ category, channel: 'EMAIL' }).select('templateCode');
        const codes = templates.map(t => t.templateCode);
        query.templateCode = { $in: codes };
    }

    const logs = await EmailLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    const total = await EmailLog.countDocuments(query);

    res.status(200).json({ success: true, data: logs, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const resendEmail = async (req: AuthRequest, res: Response) => {
  try {
    const log = await EmailLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: 'Log not found' });

    const result = await emailService.sendEmail({
      to: log.recipient,
      templateCode: log.templateCode,
      templateData: log.metadata?.templateData || {}, // Need to ensure templateData was saved in metadata
      countryCode: log.countryCode
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getEmailAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const query = countryCode === 'GLOBAL' ? {} : { countryCode: countryCode as string };

    const totalSent = await EmailLog.countDocuments({ ...query, status: 'SENT' });
    const totalFailed = await EmailLog.countDocuments({ ...query, status: 'FAILED' });

    // Aggregation for daily stats (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const dailyStats = await EmailLog.aggregate([
        { $match: { ...query, createdAt: { $gte: sevenDaysAgo } } },
        { $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            sent: { $sum: { $cond: [{ $eq: ["$status", "SENT"] }, 1, 0] } },
            failed: { $sum: { $cond: [{ $eq: ["$status", "FAILED"] }, 1, 0] } }
        }},
        { $sort: { "_id": 1 } }
    ]);

    res.status(200).json({
        success: true,
        data: {
            totalSent,
            totalFailed,
            dailyStats
        }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const testSmtp = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const result = await emailService.testSmtpConnection(countryCode as string);
    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendTestEmail = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const { recipient } = req.body;

    const result = await emailService.sendEmail({
      to: recipient,
      templateCode: 'TEST_EMAIL',
      templateData: {
        time: new Date().toLocaleString(),
        recipient
      },
      countryCode: countryCode as string
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendTemplateTest = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const { recipient, templateCode, mockData } = req.body;

    const result = await emailService.sendEmail({
      to: recipient,
      templateCode,
      templateData: mockData || {},
      countryCode: countryCode as string
    });

    res.status(200).json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const sendCategoryTest = async (req: AuthRequest, res: Response) => {
  try {
    const { countryCode } = req.query;
    const { recipient, category } = req.body;

    const templates = await NotificationTemplate.find({
      category,
      channel: 'EMAIL',
      active: true,
      $or: [{ countryCode: countryCode as string }, { countryCode: 'GLOBAL' }]
    });

    const results = [];
    for (const template of templates) {
        // Generate mock data for all placeholders
        const mockData: Record<string, string> = {};
        template.placeholders.forEach(p => {
            mockData[p] = `[TEST_${p}]`;
        });

        const res = await emailService.sendEmail({
            to: recipient,
            templateCode: template.templateCode,
            templateData: mockData,
            countryCode: countryCode as string
        });
        results.push({ template: template.templateCode, ...res });
    }

    res.status(200).json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};
