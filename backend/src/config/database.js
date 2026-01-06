'use strict';

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
const socketPath = process.env.DATABASE_SOCKET_PATH;

const pool = new Pool({
  connectionString,
  host: socketPath || undefined,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

module.exports = pool;
