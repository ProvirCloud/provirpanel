'use strict';

const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET || 'change-me';
const cookieName = process.env.AUTH_COOKIE_NAME || 'provirpanel_token';

const parseCookies = (cookieHeader) => {
  if (!cookieHeader) return {};
  return cookieHeader.split(';').reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return acc;
    const key = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
};

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies[cookieName] || cookies.token;
  const authToken = scheme === 'Bearer' && token ? token : cookieToken;

  if (!authToken) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(authToken, jwtSecret);
    req.user = {
      id: payload.sub,
      role: payload.role,
      username: payload.username
    };
    return next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};
