/* Rujuk — kode akses, kuota, dan percobaan gratis (sisi browser) */
(function (root) {
  'use strict';

  const KEY = 'rujuk_code';
  const store = {
    get() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
    set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch { /* mode privat */ } },
  };

  let code = store.get();
  let info = null;      // info kode dari server
  let trial = null;     // { remaining, per_day }
  let editing = false;
  let message = '';
  let box = null;

  const T = root.T || ((s, v) => (v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s));
  const L = () => (root.RujukI18n ? root.RujukI18n.locale : 'id-ID');
  const priceHref = () => (root.RujukI18n ? root.RujukI18n.href('/harga') : '/harga');
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const fmtDate = (iso) => new Date(iso).toLocaleDateString(L(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta' });

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: d };
  }

  async function loadTrial() {
    try {
      const r = await fetch('/api/trial');
      trial = await r.json();
    } catch { trial = null; }
  }

  async function verify(input) {
    const r = await post('/api/code', { code: input });
    if (!r.ok) throw new Error(r.data.error || T('Kode tidak dapat diperiksa.'));
    return r.data.access;
  }

  async function useCode(input) {
    message = '';
    try {
      const a = await verify(input);
      code = a.code; info = a; editing = false;
      store.set(code);
    } catch (e) {
      message = e.message;
    }
    render();
  }

  function clearCode() {
    code = ''; info = null; editing = false; message = '';
    store.set('');
    loadTrial().then(render);
  }

  function action(label, fn, cls) {
    const b = el('button', 'linkbtn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.onclick = fn;
    return b;
  }

  function render() {
    if (!box) return;
    box.replaceChildren();
    box.className = 'access';

    if (editing || (!code && message)) {
      const form = el('form', 'access-form');
      const inp = el('input');
      inp.id = 'kode-input';
      inp.placeholder = 'RJK-XXXX-XXXX-XXXX';
      inp.autocomplete = 'off';
      inp.spellcheck = false;
      inp.setAttribute('aria-label', T('Kode akses'));
      const ok = el('button', 'primary small', T('Pakai kode'));
      ok.type = 'submit';
      form.append(inp, ok, action(T('Batal'), () => { editing = false; message = ''; render(); }));
      form.onsubmit = (ev) => { ev.preventDefault(); if (inp.value.trim()) { ok.disabled = true; ok.textContent = T('Memeriksa…'); useCode(inp.value.trim()); } };
      box.append(form);
      if (message) box.append(el('div', 'access-msg', message));
      setTimeout(() => inp.focus(), 0);
      return;
    }

    const line = el('div', 'access-line');
    const txt = el('span', 'access-text');
    line.append(txt);
    if (code && info) {
      const bad = info.status !== 'aktif';
      box.classList.add(bad ? 'warn' : 'ok');
      txt.append(el('span', 'access-code', info.code), ` · ${info.plan_name} · `);
      if (info.status === 'aktif') {
        txt.append(el('b', null, T('sisa {n}', { n: info.remaining.toLocaleString(L()) })), T(' dari {total} referensi · ', { total: info.quota_total.toLocaleString(L()) }));
        txt.append(info.expires_at ? T('berlaku sampai {date}', { date: fmtDate(info.expires_at) }) : T('berlaku {n} hari sejak pertama dipakai', { n: info.days }));
      } else {
        const why = { habis: T('kuota sudah habis'), kedaluwarsa: T('masa berlaku berakhir {date}', { date: info.expires_at ? fmtDate(info.expires_at) : '' }), nonaktif: T('kode dinonaktifkan') }[info.status];
        txt.append(el('b', null, why));
      }
      const acts = el('span', 'access-acts');
      if (info.status !== 'aktif') { const a = el('a', 'linkbtn', T('Beli paket')); a.href = priceHref(); acts.append(a); }
      acts.append(action(T('Ganti kode'), () => { editing = true; render(); }), action(T('Keluar'), clearCode));
      line.append(acts);
    } else {
      txt.append(T('Mode percobaan gratis'));
      if (trial) txt.append(T(' · kuota gratis hari ini: '), el('b', null, T('{r} dari {p}', { r: trial.remaining, p: trial.per_day })), T(' referensi (untuk semua fitur)'));
      const acts = el('span', 'access-acts');
      acts.append(action(T('Masukkan kode akses'), () => { editing = true; render(); }, 'strong'));
      const a = el('a', 'linkbtn', T('Lihat paket')); a.href = priceHref();
      acts.append(a);
      line.append(acts);
    }
    box.append(line);
    if (message) box.append(el('div', 'access-msg', message));
  }

  // Dipanggil setelah setiap respons /api/check
  function update(a) {
    if (!a) return;
    if (a.mode === 'code' && a.code) info = a;
    if (a.mode === 'trial') trial = { remaining: a.remaining, per_day: a.per_day };
    render();
  }

  // Ukuran kelompok berikutnya agar sisa kuota terpakai penuh
  function batchSize(max) {
    if (code && info && info.status === 'aktif') return Math.max(1, Math.min(max, info.remaining || max));
    if (!code && trial) return Math.max(1, Math.min(max, trial.remaining || max));
    return max;
  }

  function headers() {
    return code ? { 'X-Access-Code': code } : {};
  }

  async function init(container) {
    box = container;
    const url = new URL(location.href);
    const fromLink = url.searchParams.get('kode');
    if (fromLink) {
      url.searchParams.delete('kode');
      history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
      await useCode(fromLink);
      if (!code) await loadTrial();
      render();
      return;
    }
    if (code) {
      try { info = await verify(code); } catch (e) { message = T('Kode tersimpan ({code}) tidak valid lagi: {msg}', { code, msg: e.message }); code = ''; store.set(''); }
    }
    if (!code) await loadTrial();
    render();
  }

  function showMessage(text) { message = text; render(); }

  root.RujukAccess = { init, update, headers, batchSize, showMessage, hasCode: () => !!code };
})(typeof self !== 'undefined' ? self : this);
