'use strict';

const express = require('express');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const pool = require('../config/database');
const authMiddleware = require('../middleware/auth');

const router = express.Router();

const jwtSecret = process.env.JWT_SECRET || 'change-me';
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1d';
const cookieName = process.env.AUTH_COOKIE_NAME || 'provirpanel_token';
const cookieSecure =
  process.env.AUTH_COOKIE_SECURE === 'true' ||
  (process.env.NODE_ENV === 'production');

const parseExpiresToMs = (value) => {
  if (!value || typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+)([smhd])$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return amount * multipliers[unit];
};

const setAuthCookie = (req, res, token) => {
  const maxAge = parseExpiresToMs(jwtExpiresIn);
  const options = {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure || req.secure,
    path: '/'
  };
  if (maxAge) {
    options.maxAge = maxAge;
  }
  res.cookie(cookieName, token, options);
};

const clearAuthCookie = (req, res) => {
  res.clearCookie(cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure || req.secure,
    path: '/'
  });
};

const generateUuid = () => {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

router.post('/register', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const existing = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    if (existing.rows[0].count > 0) {
      return res.status(403).json({ message: 'Registration closed' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const insert = await pool.query(
      'INSERT INTO users (id, username, password, role) VALUES ($1, $2, $3, $4) RETURNING id, username, role, created_at',
      [generateUuid(), username, passwordHash, 'admin']
    );

    return res.status(201).json({ user: insert.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    const result = await pool.query(
      'SELECT id, username, password, role, mfa_enabled, mfa_secret, mfa_required FROM users WHERE username = $1',
      [username]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const matches = await bcrypt.compare(password, user.password);
    if (!matches) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (user.mfa_enabled && user.mfa_secret) {
      const mfaToken = jwt.sign(
        { sub: user.id, role: user.role, username: user.username, mfa: true },
        jwtSecret,
        { expiresIn: '5m' }
      );
      return res.json({
        mfaRequired: true,
        mfaToken,
        user: { id: user.id, username: user.username, role: user.role }
      });
    }

    if (user.mfa_required) {
      const mfaSetupToken = jwt.sign(
        { sub: user.id, role: user.role, username: user.username, mfaSetup: true },
        jwtSecret,
        { expiresIn: '10m' }
      );
      return res.json({
        mfaSetupRequired: true,
        mfaSetupToken,
        user: { id: user.id, username: user.username, role: user.role }
      });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role, username: user.username },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    setAuthCookie(req, res, token);
    return res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/mfa/confirm', async (req, res, next) => {
  try {
    const { token, mfaToken } = req.body || {};
    if (!token || !mfaToken) {
      return res.status(400).json({ message: 'token and mfaToken are required' });
    }

    let payload;
    try {
      payload = jwt.verify(mfaToken, jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid mfa token' });
    }
    if (!payload || !payload.sub || !payload.mfa) {
      return res.status(401).json({ message: 'Invalid mfa token' });
    }

    const result = await pool.query(
      'SELECT id, username, role, mfa_enabled, mfa_secret FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.mfa_enabled || !user.mfa_secret) {
      return res.status(401).json({ message: 'MFA not enabled' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token,
      window: 1
    });
    if (!verified) {
      return res.status(401).json({ message: 'Invalid MFA code' });
    }

    const authToken = jwt.sign(
      { sub: user.id, role: user.role, username: user.username },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    setAuthCookie(req, res, authToken);
    return res.json({
      token: authToken,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/logout', (req, res) => {
  clearAuthCookie(req, res);
  res.json({ message: 'Logged out' });
});

router.post('/change-password', authMiddleware, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'currentPassword and newPassword are required' });
    }

    const result = await pool.query('SELECT id, password FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [passwordHash, user.id]);
    return res.json({ status: 'updated' });
  } catch (err) {
    return next(err);
  }
});

router.post('/users', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { username, password, role, mfaRequired } = req.body || {};
    if (!username || !password || !role) {
      return res.status(400).json({ message: 'username, password and role are required' });
    }
    if (!['admin', 'dev', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    const existing = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: 'Username already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const insert = await pool.query(
      'INSERT INTO users (id, username, password, role, mfa_required) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, role, created_at, mfa_required',
      [generateUuid(), username, passwordHash, role, !!mfaRequired]
    );
    return res.status(201).json({ user: insert.rows[0] });
  } catch (err) {
    return next(err);
  }
});

router.get('/me', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, created_at, mfa_enabled, mfa_required FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
});

router.get('/users', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const result = await pool.query(
      'SELECT id, username, role, created_at, mfa_enabled, mfa_required FROM users ORDER BY created_at DESC'
    );
    return res.json({ users: result.rows });
  } catch (err) {
    return next(err);
  }
});

router.put('/users/:id', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { id } = req.params;
    const { username, password, role, mfaRequired } = req.body || {};
    
    if (!username || !role) {
      return res.status(400).json({ message: 'username and role are required' });
    }
    if (!['admin', 'dev', 'viewer'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    let query = 'UPDATE users SET username = $1, role = $2, mfa_required = $3 WHERE id = $4';
    let params = [username, role, !!mfaRequired, id];
    
    if (password) {
      const passwordHash = await bcrypt.hash(password, 12);
      query = 'UPDATE users SET username = $1, role = $2, password = $3, mfa_required = $4 WHERE id = $5';
      params = [username, role, passwordHash, !!mfaRequired, id];
    }
    
    await pool.query(query, params);
    return res.json({ message: 'User updated' });
  } catch (err) {
    return next(err);
  }
});

router.get('/mfa/status', authMiddleware, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT mfa_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    return res.json({ enabled: !!user?.mfa_enabled });
  } catch (err) {
    return next(err);
  }
});

router.post('/mfa/setup', authMiddleware, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      'SELECT id, username, mfa_enabled FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.mfa_enabled) {
      return res.status(400).json({ message: 'MFA already enabled' });
    }

    const secret = speakeasy.generateSecret({
      name: `ProvirPanel (${user.username})`
    });
    await pool.query(
      'UPDATE users SET mfa_temp_secret = $1 WHERE id = $2',
      [secret.base32, user.id]
    );

    const qr = await qrcode.toDataURL(secret.otpauth_url || '');
    return res.json({
      otpauthUrl: secret.otpauth_url,
      secret: secret.base32,
      qr
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/mfa/setup-login', async (req, res, next) => {
  try {
    const { mfaSetupToken } = req.body || {};
    if (!mfaSetupToken) {
      return res.status(400).json({ message: 'mfaSetupToken is required' });
    }
    let payload;
    try {
      payload = jwt.verify(mfaSetupToken, jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid setup token' });
    }
    if (!payload?.sub || !payload.mfaSetup) {
      return res.status(401).json({ message: 'Invalid setup token' });
    }

    const userResult = await pool.query(
      'SELECT id, username, mfa_enabled, mfa_required FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    if (user.mfa_enabled) {
      return res.status(400).json({ message: 'MFA already enabled' });
    }
    if (!user.mfa_required) {
      return res.status(400).json({ message: 'MFA not required' });
    }

    const secret = speakeasy.generateSecret({
      name: `ProvirPanel (${user.username})`
    });
    await pool.query(
      'UPDATE users SET mfa_temp_secret = $1 WHERE id = $2',
      [secret.base32, user.id]
    );

    const qr = await qrcode.toDataURL(secret.otpauth_url || '');
    return res.json({
      otpauthUrl: secret.otpauth_url,
      secret: secret.base32,
      qr
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/mfa/enable-login', async (req, res, next) => {
  try {
    const { token, mfaSetupToken } = req.body || {};
    if (!token || !mfaSetupToken) {
      return res.status(400).json({ message: 'token and mfaSetupToken are required' });
    }
    let payload;
    try {
      payload = jwt.verify(mfaSetupToken, jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid setup token' });
    }
    if (!payload?.sub || !payload.mfaSetup) {
      return res.status(401).json({ message: 'Invalid setup token' });
    }

    const result = await pool.query(
      'SELECT id, username, role, mfa_temp_secret, mfa_required FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.mfa_temp_secret) {
      return res.status(400).json({ message: 'MFA not initialized' });
    }
    if (!user.mfa_required) {
      return res.status(400).json({ message: 'MFA not required' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_temp_secret,
      encoding: 'base32',
      token,
      window: 1
    });
    if (!verified) {
      return res.status(401).json({ message: 'Invalid MFA code' });
    }

    await pool.query(
      'UPDATE users SET mfa_enabled = true, mfa_secret = $1, mfa_temp_secret = NULL WHERE id = $2',
      [user.mfa_temp_secret, user.id]
    );

    const authToken = jwt.sign(
      { sub: user.id, role: user.role, username: user.username },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );

    setAuthCookie(req, res, authToken);
    return res.json({
      token: authToken,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/mfa/enable', authMiddleware, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ message: 'token is required' });
    }

    const result = await pool.query(
      'SELECT id, mfa_temp_secret FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user || !user.mfa_temp_secret) {
      return res.status(400).json({ message: 'MFA not initialized' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_temp_secret,
      encoding: 'base32',
      token,
      window: 1
    });
    if (!verified) {
      return res.status(401).json({ message: 'Invalid MFA code' });
    }

    await pool.query(
      'UPDATE users SET mfa_enabled = true, mfa_secret = $1, mfa_temp_secret = NULL WHERE id = $2',
      [user.mfa_temp_secret, user.id]
    );

    return res.json({ enabled: true });
  } catch (err) {
    return next(err);
  }
});

router.post('/mfa/disable', authMiddleware, async (req, res, next) => {
  try {
    const { token } = req.body || {};
    if (!token) {
      return res.status(400).json({ message: 'token is required' });
    }

    const result = await pool.query(
      'SELECT id, mfa_secret FROM users WHERE id = $1',
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user || !user.mfa_secret) {
      return res.status(400).json({ message: 'MFA not enabled' });
    }

    const verified = speakeasy.totp.verify({
      secret: user.mfa_secret,
      encoding: 'base32',
      token,
      window: 1
    });
    if (!verified) {
      return res.status(401).json({ message: 'Invalid MFA code' });
    }

    await pool.query(
      'UPDATE users SET mfa_enabled = false, mfa_secret = NULL, mfa_temp_secret = NULL WHERE id = $1',
      [user.id]
    );
    return res.json({ enabled: false });
  } catch (err) {
    return next(err);
  }
});

router.delete('/users/:id', authMiddleware, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { id } = req.params;
    
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ message: 'Cannot delete yourself' });
    }
    
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    return res.json({ message: 'User deleted' });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
