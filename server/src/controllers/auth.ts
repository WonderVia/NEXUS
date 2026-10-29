import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/schema.js';
import { CONFIG } from '../config.js';
import { AuthenticatedRequest } from '../middleware/auth.js';

export async function register(req: Request, res: Response) {
  try {
    const { name, email, password, role = 'student' } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
    if (existingUser) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    const createdAt = new Date().toISOString();
    const assignedRole = role === 'admin' ? 'admin' : 'student';

    db.prepare(`
      INSERT INTO users (id, name, email, passwordHash, role, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, name.trim(), email.toLowerCase().trim(), passwordHash, assignedRole, createdAt);

    const token = jwt.sign(
      { id: userId, name: name.trim(), email: email.toLowerCase().trim(), role: assignedRole },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN as any }
    );

    return res.status(201).json({
      message: 'Registration successful',
      token,
      user: {
        id: userId,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        role: assignedRole
      }
    });
  } catch (err: any) {
    console.error('Registration error:', err);
    return res.status(500).json({ error: 'Internal server error during registration' });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN as any }
    );

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err: any) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error during login' });
  }
}

// Request OTP endpoint for 2FA / Pre-exam verification
export async function requestOtp(req: Request, res: Response) {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // In production, send via SendGrid/SES. For hackathon demo, generate dev OTP and return it clearly.
    const otp = CONFIG.DEV_OTP;
    const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    db.prepare('UPDATE users SET otp = ?, otpExpiry = ? WHERE id = ?').run(otp, expiry, user.id);

    return res.json({
      message: 'Verification code generated',
      devOtp: otp, // Clearly labelled development mode OTP
      hint: 'In demo mode, use the code displayed above or check server logs.'
    });
  } catch (err: any) {
    console.error('Request OTP error:', err);
    return res.status(500).json({ error: 'Error generating OTP' });
  }
}

// Verify OTP
export async function verifyOtp(req: Request, res: Response) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const user: any = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.otp !== otp.trim()) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Clear OTP after successful verification
    db.prepare('UPDATE users SET otp = NULL, otpExpiry = NULL WHERE id = ?').run(user.id);

    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      CONFIG.JWT_SECRET,
      { expiresIn: CONFIG.JWT_EXPIRES_IN as any }
    );

    return res.json({
      message: 'OTP verified successfully',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err: any) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ error: 'Error verifying OTP' });
  }
}

export function getCurrentUser(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  const user: any = db.prepare('SELECT id, name, email, role, createdAt FROM users WHERE id = ?').get(req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({ user });
}

export function getAllStudents(req: AuthenticatedRequest, res: Response) {
  const students = db.prepare(`SELECT id, name, email, role, createdAt FROM users WHERE role = 'student' ORDER BY createdAt DESC`).all();
  return res.json({ students });
}
