import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import fs from 'fs';
import { CONFIG } from './config.js';
import { initDatabase } from './db/schema.js';
import routes from './routes.js';

// Resolve client dist path across dev and built dist runs
const candidatePaths = [
  path.resolve(process.cwd(), 'client/dist'),
  path.resolve(process.cwd(), '../client/dist'),
  typeof __dirname !== 'undefined' ? path.resolve(__dirname, '../../client/dist') : ''
].filter(Boolean);

const clientDistPath = candidatePaths.find(p => fs.existsSync(p)) || candidatePaths[0];

const app = express();

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false // Managed strictly by Electron preload
}));

// CORS configuration for React dev server, Electron, and Browser Extension Companion
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (mobile, curl, extension background scripts) and extension origins
    if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://') || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    // Allow requests from monitored websites (ChatGPT, Claude) for content script telemetry
    return callback(null, true);
  },
  credentials: true
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting for authentication routes to prevent brute-forcing
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100, // 100 attempts per 15 minutes
  message: { error: 'Too many requests from this IP, please try again after 15 minutes' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Smart Proctoring API',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api', routes);

// Serve static frontend assets if built client exists
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path === '/health') {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected internal server error occurred' });
});

// Initialize database and start server
initDatabase();

if (process.env.NODE_ENV !== 'test') {
  app.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`  WUElev8 Smart Proctoring Browser - Backend Server`);
    console.log(`  Status: Running on http://localhost:${CONFIG.PORT}`);
    console.log(`  Environment: ${CONFIG.NODE_ENV}`);
    console.log(`=======================================================`);
  });
}

export default app;
