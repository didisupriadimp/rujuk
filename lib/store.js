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
      db.stats = db.stats || { daily: {}, uniq: {} };
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
    // ---- Statistik pengunjung ----
    async addStats(rows, uq) {
      const st = db.stats;
      for (const r of rows) { const d = (st.daily[r.day] = st.daily[r.day] || {}); d[r.key] = (d[r.key] || 0) + r.n; }
      for (const u of uq) {
        const d = (st.uniq[u.day] = st.uniq[u.day] || {});
        const arr = (d[u.kind] = d[u.kind] || []);
        if (!arr.includes(u.vid)) arr.push(u.vid);
      }
      const keep = new Date(Date.now() - 400 * DAY_MS).toISOString().slice(0, 10);
      for (const k of Object.keys(st.daily)) if (k < keep) delete st.daily[k];
      for (const k of Object.keys(st.uniq)) if (k < keep) delete st.uniq[k];
      save();
    },
    async readStats(from) {
      const st = db.stats;
      const daily = [];
      for (const [day, m] of Object.entries(st.daily)) if (day >= from) for (const [key, n] of Object.entries(m)) daily.push({ day, key, n });
      const uniqDaily = [];
      const range = {};
      for (const [day, m] of Object.entries(st.uniq)) {
        if (day < from) continue;
        for (const [kind, arr] of Object.entries(m)) {
          uniqDaily.push({ day, kind, n: arr.length });
          (range[kind] = range[kind] || new Set());
          arr.forEach((v) => range[kind].add(v));
        }
      }
      const uniqRange = Object.fromEntries(Object.entries(range).map(([k, v]) => [k, v.size]));
      const sales = {};
      for (const c of Object.values(db.codes)) {
        const day = new Date(new Date(c.created_at).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
        if (c.source !== 'lynk' || day < from) continue;
        sales[c.plan] = sales[c.plan] || { plan: c.plan, plan_name: c.plan_name || c.plan, n: 0 };
        sales[c.plan].n++;
      }
      return { daily, uniqDaily, uniqRange, sales: Object.values(sales) };
    },
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
        );
        CREATE TABLE IF NOT EXISTS stat_daily (
          day  DATE NOT NULL,
          key  TEXT NOT NULL,
          n    BIGINT NOT NULL DEFAULT 0,
          PRIMARY KEY (day, key)
        );
        CREATE TABLE IF NOT EXISTS stat_uniq (
          day  DATE NOT NULL,
          kind TEXT NOT NULL,
          vid  TEXT NOT NULL,
          PRIMARY KEY (day, kind, vid)
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
    // ---- Statistik pengunjung ----
    async addStats(rows, uq) {
      if (rows.length) {
        await pool.query(
          `INSERT INTO stat_daily (day, key, n)
           SELECT * FROM unnest($1::date[], $2::text[], $3::bigint[])
           ON CONFLICT (day, key) DO UPDATE SET n = stat_daily.n + EXCLUDED.n`,
          [rows.map((r) => r.day), rows.map((r) => r.key), rows.map((r) => r.n)]);
      }
      if (uq.length) {
        await pool.query(
          `INSERT INTO stat_uniq (day, kind, vid)
           SELECT * FROM unnest($1::date[], $2::text[], $3::text[])
           ON CONFLICT DO NOTHING`,
          [uq.map((r) => r.day), uq.map((r) => r.kind), uq.map((r) => r.vid)]);
      }
      // Sidik anonim hanya disimpan 400 hari
      if (Math.random() < 0.02) await pool.query(`DELETE FROM stat_uniq WHERE day < current_date - 400`);
    },
    async readStats(from) {
      const [d, ud, ur, s] = await Promise.all([
        pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, key, n::bigint AS n FROM stat_daily WHERE day >= $1::date`, [from]),
        pool.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, kind, count(*)::int AS n FROM stat_uniq WHERE day >= $1::date GROUP BY day, kind`, [from]),
        pool.query(`SELECT kind, count(DISTINCT vid)::int AS n FROM stat_uniq WHERE day >= $1::date GROUP BY kind`, [from]),
        pool.query(`SELECT plan, max(plan_name) AS plan_name, count(*)::int AS n FROM access_codes
                    WHERE source = 'lynk' AND (created_at AT TIME ZONE 'Asia/Jakarta')::date >= $1::date GROUP BY plan`, [from]),
      ]);
      return {
        daily: d.rows.map((r) => ({ day: r.day, key: r.key, n: Number(r.n) })),
        uniqDaily: ud.rows,
        uniqRange: Object.fromEntries(ur.rows.map((r) => [r.kind, r.n])),
        sales: s.rows,
      };
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
