import dotenv from 'dotenv';
import initializeFirebase from './config/firebase';
import { logger } from './utils/logger';

dotenv.config();

// Initialize Firebase IMMEDIATELY before other imports to prevent side-effect inits
initializeFirebase();

import http from 'http';
import app from './app';
import { initSocket } from './socket/socket.service';
import { initSchedulers } from './services/scheduler.service';
import * as jobService from './services/job.service';
import * as categoryController from './controllers/admin/service-category.controller';
import mongoose from 'mongoose';

const port = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Initialize Schedulers
initSchedulers();

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';
logger.debug(`Attempting MongoDB connection...`);

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
})
  .then(async () => {
      logger.info('✅ Connected to MongoDB');
      // Initialize dynamic categories
      await categoryController.seedCategories();
      // Resume interrupted broadcasts
      await jobService.resumeBroadcasts();
  })
  .catch((err) => {
      logger.error('❌ MongoDB connection error:', err.message);
      logger.error('Please verify your MONGO_URI in Render environment variables.');
  });

server.listen(port, () => {
  logger.info(`Server is running on port ${port}`);
});
