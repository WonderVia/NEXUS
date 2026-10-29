import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 5000,
  JWT_SECRET: process.env.JWT_SECRET || 'wuelev8-smart-proctoring-super-secret-key-2026',
  JWT_EXPIRES_IN: '12h',
  NODE_ENV: process.env.NODE_ENV || 'development',
  DEV_OTP: '884920' // Static verifiable OTP for local dev/hackathon demo
};
