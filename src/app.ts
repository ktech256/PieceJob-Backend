import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import providerRoutes from './routes/provider.routes';
import jobRoutes from './routes/job.routes';
import paymentRoutes from './routes/payment.routes';
import walletRoutes from './routes/wallet.routes';
import chatRoutes from './routes/chat.routes';
import notificationRoutes from './routes/notification.routes';
import sosRoutes from './routes/sos.routes';
import adminRoutes from './routes/admin.routes';
import disputeRoutes from './routes/dispute.routes';
import configRoutes from './routes/config.routes';
import corporateRoutes from './routes/corporate.routes';
import supportRoutes from './routes/support.routes';
import callRoutes from './routes/call.routes';
import analyticsRoutes from './routes/v1/analytics.routes';
import testRoutes from './routes/test.routes';
import admin from 'firebase-admin';
import { logger } from './utils/logger';

// PieceJob Backend - V3.1
const app = express();

logger.info(`PieceJob Backend starting...`);

app.use(helmet());
app.use(cors());

// Capture RAW BODY for signature verification (Critical for Payment Webhooks)
app.use(express.json({
    limit: '50mb',
    verify: (req: any, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// REQUEST LOGGER (Only for non-health/non-analytics requests or when DEBUG enabled)
app.use((req: any, res, next) => {
    const isNoisy = req.path === '/health' ||
                   req.path.includes('/analytics') ||
                   req.path.includes('/countries') ||
                   req.path.includes('/admin') ||
                   req.method === 'GET';

    if (!isNoisy) {
        const userId = req.headers['authorization'] ? 'TOKEN_PRESENT' : 'ANONYMOUS';
        logger.debug(`[HTTP] ${req.method} ${req.path} | User: ${userId}`);
    }
    next();
});

// API Routes (V1 and Dashboard compatibility)
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/providers', providerRoutes);
app.use('/api/v1/jobs', jobRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/wallets', walletRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/sos', sosRoutes);
app.use('/api/v1/calls', callRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/disputes', disputeRoutes);
app.use('/api/v1/config', configRoutes);
app.use('/api/v1/corporate', corporateRoutes);
app.use('/api/v1/support', supportRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/test', testRoutes);

// Dashboard Aliases (Mounting under /api for dashboard lib/api/axios.ts)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payouts', adminRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/customers', userRoutes);
app.use('/api/payments', paymentRoutes);

app.get('/health', async (req, res) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'CONNECTED' : 'DISCONNECTED';
  const dbName = mongoose.connection.db?.databaseName;

  let firebaseAudit = {};
  try {
      if (admin.apps.length > 0) {
          const fbApp = admin.app();
          firebaseAudit = {
              projectId: fbApp.options.projectId,
              storageBucket: fbApp.options.storageBucket,
              appsCount: admin.apps.length
          };
      } else {
          firebaseAudit = { status: 'NOT_INITIALIZED' };
      }
  } catch (e: any) {
      firebaseAudit = { error: e.message };
  }

  // Quick count audit
  const countryCount = await mongoose.model('Country').countDocuments();
  const serviceCount = await mongoose.model('Service').countDocuments();

  res.status(200).json({
      status: 'OK',
      message: 'PieceJob API is running',
      database: {
          status: dbStatus,
          name: dbName,
          countries: countryCount,
          services: serviceCount
      },
      firebase: firebaseAudit,
      timestamp: new Date().toISOString()
  });
});

export default app;
