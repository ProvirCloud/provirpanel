'use strict';

const jwt = require('jsonwebtoken');

const jwtSecret = process.env.JWT_SECRET || 'change-me';

module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  try {
    const payload = jwt.verify(token, jwtSecret);
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
