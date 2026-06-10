import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

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
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/disputes', disputeRoutes);

// Dashboard Aliases (Mounting under /api for dashboard lib/api/axios.ts)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payouts', adminRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/providers', providerRoutes);
app.use('/api/customers', userRoutes);
app.use('/api/payments', paymentRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'PieceJob API is running' });
});

export default app;
