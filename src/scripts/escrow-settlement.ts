import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { releaseEscrowFunds } from '../services/financial.service';

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/piecejob';

async function runSettlement() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to DB for settlement...');

    await releaseEscrowFunds();

    console.log('Escrow settlement task completed.');
    process.exit(0);
  } catch (error) {
    console.error('Settlement task failed:', error);
    process.exit(1);
  }
}

runSettlement();
