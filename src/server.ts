import http from 'http';
import app from './app';
import { initSocket } from './socket/socket.service';
import { initSchedulers } from './services/scheduler.service';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

const port = process.env.PORT || 5000;
const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Initialize Schedulers
initSchedulers();

// MongoDB Connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';
mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
