'use strict';

function createPressurePersistence(options = {}) {
  const connectionString = options.connectionString || process.env.DATABASE_URL || '';
  const pool = options.pool || null;
  let ready = false;
  let lastError = null;

  async function initialize() {
    if (!connectionString && !pool) return { enabled: false, reason: 'DATABASE_URL not configured' };
    try {
      if (!pool) {
        const Pg = require('pg');
        const Pool = Pg.Pool || (Pg.default && Pg.default.Pool);
        if (!Pool) throw new Error('PostgreSQL Pool unavailable');
        instance = new Pool({ connectionString, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false }, max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
      }
      await instance.query('CREATE TABLE IF NOT EXISTS pressure_observations (id BIGSERIAL PRIMARY KEY, mint TEXT NOT NULL, kind TEXT NOT NULL, observed_at TIMESTAMPTZ NOT NULL, payload JSONB NOT NULL)');
      await instance.query('CREATE INDEX IF NOT EXISTS pressure_observations_mint_time_idx ON pressure_observations (mint, observed_at DESC)');
      ready = true;
      lastError = null;
      return { enabled: true, ready: true };
    } catch (error) {
      ready = false;
      lastError = error.message;
      return { enabled: true, ready: false, reason: 'Database initialization failed' };
    }
  }

  let instance = pool;
  async function save(mint, kind, observedAt, payload) {
    if (!ready || !instance) return false;
    if (typeof mint !== 'string' || !mint || !['trade', 'snapshot', 'risk', 'alert'].includes(kind)) return false;
    const date = new Date(observedAt);
    if (!Number.isFinite(date.getTime())) return false;
    try {
      await instance.query('INSERT INTO pressure_observations (mint, kind, observed_at, payload) VALUES ($1,$2,$3,$4)', [mint, kind, date.toISOString(), JSON.stringify(payload || {})]);
      return true;
    } catch (error) {
      lastError = error.message;
      return false;
    }
  }

  async function recent(mint, limit = 100) {
    if (!ready || !instance || typeof mint !== 'string' || !mint) return [];
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 100));
    try {
      const result = await instance.query('SELECT kind, observed_at, payload FROM pressure_observations WHERE mint = $1 ORDER BY observed_at DESC LIMIT $2', [mint, safeLimit]);
      return result.rows || [];
    } catch (error) {
      lastError = error.message;
      return [];
    }
  }

  async function mints(limit = 500) {
    if (!ready || !instance) return [];
    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 500));
    try {
      const result = await instance.query('SELECT mint FROM pressure_observations GROUP BY mint ORDER BY MAX(observed_at) DESC LIMIT $1', [safeLimit]);
      return (result.rows || []).map(row => row.mint).filter(value => typeof value === 'string' && value.length > 0);
    } catch (error) { lastError = error.message; return []; }
  }

  function status() {
    return { configured: Boolean(connectionString || pool), ready, lastError: lastError ? 'Database operation failed' : null, mode: ready ? 'postgresql' : 'memory fallback', automaticTrading: false };
  }

  return { initialize, save, recent, mints, status };
}

module.exports = { createPressurePersistence };
