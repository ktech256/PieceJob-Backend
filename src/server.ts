import dotenv from 'dotenv';
import initializeFirebase from './config/firebase';

dotenv.config();

// Initialize Firebase IMMEDIATELY before other imports to prevent side-effect inits
initializeFirebase();

import http from 'http';
import app from './app';
import { initSocket } from './socket/socket.service';
import { initSchedulers } from './services/scheduler.service';
import * as jobService from './services/job.service';
import mongoose from 'mongoose';

const port = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Initialize Schedulers
initSchedulers();

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';
console.log(`Attempting MongoDB connection to: ${MONGO_URI.split('@')[1] || 'localhost'}`);

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
})
  .then(async () => {
      console.log('✅ Connected to MongoDB');
      // Resume interrupted broadcasts
      await jobService.resumeBroadcasts();
  })
  .catch((err) => {
      console.error('❌ MongoDB connection error:', err.message);
      console.error('Please verify your MONGO_URI in Render environment variables.');
  });

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
