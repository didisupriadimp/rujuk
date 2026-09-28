'use strict';

// Penyimpanan kode akses dan log webhook.
// - Bila DATABASE_URL diisi: memakai PostgreSQL (disarankan untuk produksi).
// - Bila tidak: memakai file JSON lokal (untuk uji coba; di Render isinya HILANG setiap deploy ulang).

const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 3600 * 1000;
const LOG_KEEP = 300;

// ---------------------------------------------------------------------------
// Implementasi file JSON
// ---------------------------------------------------------------------------
function fileStore(file) {
  let db = { codes: {}, logs: [] };
  let timer = null;

  function save() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + '.tmp', JSON.stringify(db));
        fs.renameSync(file + '.tmp', file);
      } catch (e) {
        console.error('[store] gagal menyimpan:', e.message);
      }
    }, 200);
  }

  const clone = (x) => (x ? JSON.parse(JSON.stringify(x)) : null);
  const expired = (c, now) => c.expires_at && new Date(c.expires_at).getTime() <= now;

  return {
    kind: 'file',
    async init() {
      try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* file baru */ }
      db.codes = db.codes || {};
      db.logs = db.logs || [];
    },
    async createCode(rec) {
      if (db.codes[rec.code]) throw new Error('Kode sudah ada.');
      if (rec.order_ref && Object.values(db.codes).some((c) => c.order_ref === rec.order_ref)) {
        const e = new Error('duplicate_order'); e.code = 'duplicate_order'; throw e;
      }
      const c = Object.assign({ quota_used: 0, disabled: false, created_at: new Date().toISOString(), activated_at: null, expires_at: null, last_used_at: null }, rec);
      db.codes[c.code] = c;
      save();
      return clone(c);
    },
    async getCode(code) { return clone(db.codes[code]); },
    async findByOrderRef(ref) { return clone(Object.values(db.codes).find((c) => c.order_ref === ref)); },
    async consume(code, n) {
      const c = db.codes[code];
      const now = Date.now();
      if (!c || c.disabled || expired(c, now) || c.quota_used + n > c.quota_total) return null;
      c.quota_used += n;
      if (!c.activated_at) {
        c.activated_at = new Date(now).toISOString();
        c.expires_at = new Date(now + c.days * DAY_MS).toISOString();
      }
      c.last_used_at = new Date(now).toISOString();
      save();
      return clone(c);
    },
    async refund(code, n) {
      const c = db.codes[code];
      if (c && n > 0) { c.quota_used = Math.max(0, c.quota_used - n); save(); }
    },
    async listCodes({ q = '', limit = 100 } = {}) {
      const s = q.toLowerCase();
      return Object.values(db.codes)
        .filter((c) => !s || [c.code, c.email, c.name, c.phone, c.order_ref, c.plan].some((v) => String(v || '').toLowerCase().includes(s)))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, limit)
        .map(clone);
    },
    async updateCode(code, patch) {
      const c = db.codes[code];
      if (!c) return null;
      Object.assign(c, patch);
      save();
      return clone(c);
    },
    async addLog(entry) {
      db.logs.unshift(Object.assign({ id: Date.now() + Math.random(), received_at: new Date().toISOString() }, entry));
      db.logs.length = Math.min(db.logs.length, LOG_KEEP);
      save();
    },
    async listLogs(limit = 50) { return db.logs.slice(0, limit).map(clone); },
    async stats() {
      const all = Object.values(db.codes);
      return { codes: all.length, active: all.filter((c) => !c.disabled && !expired(c, Date.now()) && c.quota_used < c.quota_total).length };
    },
  };
}

// ---------------------------------------------------------------------------
// Implementasi PostgreSQL
// ---------------------------------------------------------------------------
function pgStore(url) {
  const { Pool } = require('pg');
  const local = /localhost|127\.0\.0\.1/.test(url);
  const noSsl = local || /sslmode=disable/.test(url);
  // sslmode=require/prefer (bawaan Neon) diganti verify-full: tetap terenkripsi dengan sertifikat
  // yang diverifikasi penuh, dan menghilangkan peringatan dari pustaka pg.
  const connectionString = noSsl ? url : url.replace(/([?&]sslmode=)(require|prefer|verify-ca)\b/i, '$1verify-full');
  const pool = new Pool({
    connectionString,
    ssl: noSsl ? false : { rejectUnauthorized: true },
    max: 5,
  });

  const row = (r) => r && Object.assign({}, r, {
    created_at: r.created_at && r.created_at.toISOString(),
    activated_at: r.activated_at && r.activated_at.toISOString(),
    expires_at: r.expires_at && r.expires_at.toISOString(),
    last_used_at: r.last_used_at && r.last_used_at.toISOString(),
  });

  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS access_codes (
          code         TEXT PRIMARY KEY,
          plan         TEXT NOT NULL,
          plan_name    TEXT,
          quota_total  INTEGER NOT NULL,
          quota_used   INTEGER NOT NULL DEFAULT 0,
          days         INTEGER NOT NULL,
          email        TEXT,
          name         TEXT,
          phone        TEXT,
          source       TEXT,
          order_ref    TEXT UNIQUE,
          note         TEXT,
          disabled     BOOLEAN NOT NULL DEFAULT FALSE,
          email_sent   BOOLEAN NOT NULL DEFAULT FALSE,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          activated_at TIMESTAMPTZ,
          expires_at   TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS access_codes_email ON access_codes (lower(email));
        CREATE TABLE IF NOT EXISTS webhook_log (
          id          BIGSERIAL PRIMARY KEY,
          received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          source      TEXT,
          body        TEXT,
          result      TEXT
        );`);
    },
    async createCode(rec) {
      try {
        const r = await pool.query(
          `INSERT INTO access_codes (code, plan, plan_name, quota_total, days, email, name, phone, source, order_ref, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [rec.code, rec.plan, rec.plan_name || null, rec.quota_total, rec.days, rec.email || null, rec.name || null,
            rec.phone || null, rec.source || null, rec.order_ref || null, rec.note || null]);
        return row(r.rows[0]);
      } catch (e) {
        if (e.code === '23505' && /order_ref/.test(e.detail || e.constraint || '')) {
          const d = new Error('duplicate_order'); d.code = 'duplicate_order'; throw d;
        }
        throw e;
      }
    },
    async getCode(code) {
      const r = await pool.query('SELECT * FROM access_codes WHERE code = $1', [code]);
      return row(r.rows[0]);
    },
    async findByOrderRef(ref) {
      const r = await pool.query('SELECT * FROM access_codes WHERE order_ref = $1', [ref]);
      return row(r.rows[0]);
    },
    // Satu perintah UPDATE = aman walau ada banyak permintaan bersamaan
    async consume(code, n) {
      const r = await pool.query(
        `UPDATE access_codes SET
           quota_used   = quota_used + $2,
           activated_at = COALESCE(activated_at, now()),
           expires_at   = COALESCE(expires_at, now() + make_interval(days => days)),
           last_used_at = now()
         WHERE code = $1 AND NOT disabled
           AND (expires_at IS NULL OR expires_at > now())
           AND quota_used + $2 <= quota_total
         RETURNING *`, [code, n]);
      return row(r.rows[0]);
    },
    async refund(code, n) {
      if (n > 0) await pool.query('UPDATE access_codes SET quota_used = GREATEST(0, quota_used - $2) WHERE code = $1', [code, n]);
    },
    async listCodes({ q = '', limit = 100 } = {}) {
      const r = await pool.query(
        `SELECT * FROM access_codes
         WHERE $1 = '' OR code ILIKE $2 OR email ILIKE $2 OR name ILIKE $2 OR phone ILIKE $2 OR order_ref ILIKE $2 OR plan ILIKE $2
         ORDER BY created_at DESC LIMIT $3`, [q, `%${q}%`, limit]);
      return r.rows.map(row);
    },
    async updateCode(code, patch) {
      const allowed = ['disabled', 'quota_total', 'expires_at', 'note', 'email', 'name', 'phone', 'email_sent', 'days'];
      const keys = Object.keys(patch).filter((k) => allowed.includes(k));
      if (!keys.length) return this.getCode(code);
      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const r = await pool.query(`UPDATE access_codes SET ${sets} WHERE code = $1 RETURNING *`, [code, ...keys.map((k) => patch[k])]);
      return row(r.rows[0]);
    },
    async addLog(entry) {
      await pool.query('INSERT INTO webhook_log (source, body, result) VALUES ($1,$2,$3)', [entry.source || null, entry.body || null, entry.result || null]);
      await pool.query(`DELETE FROM webhook_log WHERE id < (SELECT COALESCE(MIN(id), 0) FROM (SELECT id FROM webhook_log ORDER BY id DESC LIMIT ${LOG_KEEP}) t)`);
    },
    async listLogs(limit = 50) {
      const r = await pool.query('SELECT * FROM webhook_log ORDER BY id DESC LIMIT $1', [limit]);
      return r.rows.map((x) => Object.assign({}, x, { id: Number(x.id), received_at: x.received_at.toISOString() }));
    },
    async stats() {
      const r = await pool.query(`SELECT count(*)::int AS codes,
        count(*) FILTER (WHERE NOT disabled AND (expires_at IS NULL OR expires_at > now()) AND quota_used < quota_total)::int AS active
        FROM access_codes`);
      return r.rows[0];
    },
  };
}

function create() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return fileStore(path.join(__dirname, '..', 'storage', 'store.json'));
}

module.exports = { create, fileStore, pgStore };
