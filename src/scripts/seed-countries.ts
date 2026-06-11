import mongoose from 'mongoose';
import Country from '../models/Country';
import ExchangeRate from '../models/ExchangeRate';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/piecejob';

const countries = [
  {
    name: 'South Africa',
    code: 'ZA',
    currency: 'ZAR',
    timezone: 'Africa/Johannesburg',
    language: 'EN',
    locale: 'en-ZA',
    flagEmoji: '🇿🇦'
  },
  {
    name: 'Botswana',
    code: 'BW',
    currency: 'BWP',
    timezone: 'Africa/Gaborone',
    language: 'EN',
    locale: 'en-BW',
    flagEmoji: '🇧🇼'
  },
  {
    name: 'Namibia',
    code: 'NA',
    currency: 'NAD',
    timezone: 'Africa/Windhoek',
    language: 'EN',
    locale: 'en-NA',
    flagEmoji: '🇳🇦'
  }
];

const exchangeRates = [
    { fromCurrency: 'ZAR', toCurrency: 'USD', rate: 0.053 },
    { fromCurrency: 'BWP', toCurrency: 'USD', rate: 0.074 },
    { fromCurrency: 'NAD', toCurrency: 'USD', rate: 0.053 }
];

const seed = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    for (const country of countries) {
      await Country.findOneAndUpdate({ code: country.code }, country, { upsert: true });
    }
    console.log('Countries seeded');

    for (const rate of exchangeRates) {
        await ExchangeRate.findOneAndUpdate(
            { fromCurrency: rate.fromCurrency, toCurrency: rate.toCurrency },
            rate,
            { upsert: true }
        );
    }
    console.log('Exchange rates seeded');

    await mongoose.disconnect();
  } catch (error) {
    console.error('Seed error:', error);
  }
};

seed();
