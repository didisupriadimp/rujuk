/* Rujuk — Perbaiki Style
   Tempel daftar pustaka → diformat ulang sesuai style (APA 7, IEEE, Harvard, Chicago, MLA, Vancouver).
   Tampilan dua kolom per referensi (Asli | Hasil), bisa dilengkapi dari database, diedit, dan ditandai beres. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  const input = $('st-input'), errEl = $('st-error'), styleSel = $('st-style'), langSel = $('st-lang'), sentence = $('st-sentence');
  const bar = $('st-progress'), barFill = bar.firstElementChild;
  let styles = [];
  let items = [];       // { text, csl, source, verified, fixed, issues, html, plain, note, similar }
  let order = [];       // urutan hasil sesuai style
  let filter = 'all';
  let editing = null;
  let busy = false;

  const TYPES = [
    ['article-journal', 'Artikel jurnal'],
    ['paper-conference', 'Makalah prosiding / konferensi'],
    ['book', 'Buku'],
    ['chapter', 'Bab dalam buku (book chapter)'],
    ['thesis', 'Skripsi / Tesis / Disertasi'],
    ['report', 'Laporan / dokumen resmi'],
    ['webpage', 'Halaman web'],
  ];
  const typeName = (t) => (TYPES.find((x) => x[0] === t) || [t, 'Referensi'])[1];

  // ---------------------------------------------------------------------------
  // Utilitas
  // ---------------------------------------------------------------------------
  function safeHtml(html) {
    return String(html || '')
      .replace(/<(?!\/?(i|b|em|strong|sup|sub)>)[^>]*>/gi, '');
  }
  function plainOf(html) {
    const d = document.createElement('div');
    d.innerHTML = safeHtml(html);
    return (d.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function normCompare(s) {
    return String(s || '')
      .replace(/[“”„"]/g, '"').replace(/[‘’`']/g, "'").replace(/[–—−]/g, '-')
      .replace(/https?:\/\/(dx\.)?doi\.org\//gi, 'doi:').replace(/\bdoi:\s*/gi, 'doi:')
      .replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  }
  function setError(msg, withPriceLink) {
    errEl.replaceChildren(msg || '');
    if (withPriceLink) {
      const a = el('a', null, 'Lihat paket dan harga');
      a.href = '/harga';
      errEl.append(' ', a);
    }
  }
  function currentStyle() { return styles.find((s) => s.id === styleSel.value) || { id: 'apa', name: 'APA 7th' }; }

  // ---------------------------------------------------------------------------
  // Style
  // ---------------------------------------------------------------------------
  fetch('/api/styles').then((r) => r.json()).then((d) => {
    styles = d.styles || [];
    styleSel.replaceChildren(...styles.map((s) => { const o = el('option', null, s.name); o.value = s.id; return o; }));
    styleSel.value = 'apa';
    sentence.checked = true;
  }).catch(() => setError('Gagal memuat daftar style. Muat ulang halaman.'));

  styleSel.addEventListener('change', () => {
    sentence.checked = !!currentStyle().sentenceCase;
    if (items.length) reformat();
  });
  langSel.addEventListener('change', () => { if (items.length) reformat(); });
  sentence.addEventListener('change', () => { if (items.length) reformat(); });

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function updateCount() {
    const n = CiteCheck.splitRefs(input.value).length;
    $('st-count').textContent = n ? `${n} referensi terdeteksi · memakai ${n} kuota` : '';
  }
  input.addEventListener('input', updateCount);

  $('st-ambil').onclick = () => {
    const v = $('input').value.trim();
    if (!v) { setError('Kotak daftar pustaka di tab Cek Referensi masih kosong.'); return; }
    setError('');
    input.value = v; updateCount();
  };

  $('st-file').addEventListener('change', async (ev) => {
    const f = ev.target.files[0];
    ev.target.value = '';
    if (!f) return;
    setError('');
    $('st-fileinfo').textContent = `Membaca ${f.name}…`;
    try {
      const d = await DocxText.read(f);
      const { refs } = CiteCheck.splitManuscript(d.text);
      if (!refs) {
        $('st-fileinfo').textContent = '';
        setError(`Judul "Daftar Pustaka" atau "References" tidak ditemukan di ${f.name}. Salin daftar pustakanya secara manual.`);
        return;
      }
      input.value = refs; updateCount();
      $('st-fileinfo').textContent = `Daftar pustaka diambil dari ${f.name}.`;
    } catch (e) {
      $('st-fileinfo').textContent = '';
      setError(e.message);
    }
  });

  $('st-clear').onclick = () => {
    input.value = ''; items = []; order = []; editing = null;
    $('st-out').hidden = true; $('st-fileinfo').textContent = ''; setError(''); updateCount(); input.focus();
  };

  // Perbaiki: cocokkan tiap referensi dengan database (1 kuota/referensi), lalu format
  $('st-go').onclick = async () => {
    if (busy) return;
    setError('');
    const refs = CiteCheck.splitRefs(input.value).map((r) => r.text);
    if (!refs.length) { setError('Belum ada referensi yang bisa dibaca.'); return; }
    if (refs.length > 500) { setError('Maksimal 500 referensi sekali proses.'); return; }
    items = refs.map((text) => ({ text, csl: null, source: 'teks', verified: false, fixed: false, pending: true }));
    filter = 'all'; editing = null; order = [];
    busy = true;
    const go = $('st-go');
    go.disabled = true;
    bar.style.display = 'block'; barFill.style.width = '0';
    let done = 0;
    try {
      for (let k = 0; k < items.length;) {
        const size = RujukAccess.batchSize(8);
        const idx = items.map((_, i) => i).slice(k, k + size);
        go.textContent = `Memproses… ${done}/${items.length}`;
        const results = await checkRefs(idx.map((i) => items[i].text));
        results.forEach((r, j) => applyCheck(items[idx[j]], r));
        k += idx.length; done = k;
        barFill.style.width = Math.round((done / items.length) * 100) + '%';
      }
    } catch (e) {
      setError(e.message + (done ? ` (${done} dari ${items.length} referensi sudah diproses; sisanya belum.)` : ''), e.quota);
    } finally {
      busy = false;
      go.disabled = false; go.textContent = 'Perbaiki';
      setTimeout(() => { bar.style.display = 'none'; }, 600);
    }
    items = items.filter((it) => !it.pending);
    if (items.length) await reformat(true);
  };

  // Tombol dari tab Cek Referensi
  const toStyle = $('tostyle');
  if (toStyle) toStyle.onclick = () => {
    const last = window.RujukLastCheck;
    if (!last || !last.results.length) return;
    input.value = last.refs.join('\n'); updateCount();
    window.RujukShowTab('style');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ---------------------------------------------------------------------------
  // Format (gratis, di server)
  // ---------------------------------------------------------------------------
  async function reformat(scroll) {
    if (!items.length) return;
    const go = $('st-go');
    go.disabled = true; go.textContent = 'Memproses…';
    try {
      const res = await fetch('/api/format', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((it) => ({ csl: it.csl || {} })),
          style: styleSel.value, lang: langSel.value, sentenceCase: sentence.checked,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'Gagal memformat.');
      d.items.forEach((x, i) => { items[i].csl = x.csl; items[i].issues = x.issues; });
      order = d.entries.map((e) => e.index);
      d.entries.forEach((e) => {
        const it = items[e.index];
        it.html = safeHtml(e.html);
        it.plain = plainOf(e.html);
        it.good = !it.fixed && normCompare(it.text) === normCompare(it.plain);
      });
      render();
      if (scroll) $('st-out').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      setError(e.message);
    } finally {
      if (!busy) { go.disabled = false; go.textContent = 'Perbaiki'; }
    }
  }

  // ---------------------------------------------------------------------------
  // Lengkapi dari database (memakai kuota Cek Referensi)
  // ---------------------------------------------------------------------------
  async function checkRefs(texts) {
    const res = await fetch('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...RujukAccess.headers() },
      body: JSON.stringify({ references: texts, feature: 'style' }),
    });
    const d = await res.json().catch(() => ({}));
    if (d.access) RujukAccess.update(d.access);
    if (res.status === 402) { const e = new Error(d.error || 'Kuota tidak cukup.'); e.quota = true; throw e; }
    if (!res.ok) throw new Error(d.error || 'Server tidak merespons dengan benar.');
    return d.results;
  }

  function applyCheck(it, r) {
    it.pending = false;
    it.checkLabel = r.label;
    it.similar = null;
    it.csl = r.csl || r.csl_text || {};
    if (r.csl_verified && r.csl) {
      it.source = r.csl_source; it.verified = true;
      it.note = `Data diambil dari ${r.csl_source}.`;
    } else if (r.match && r.match.csl && r.status === 'periksa') {
      it.source = 'teks';
      it.similar = { csl: r.match.csl, source: r.match.source, title: r.match.title };
      it.note = `Ada karya yang mirip di ${r.match.source}, tetapi belum pasti sama. Periksa, lalu pakai datanya bila memang benar.`;
    } else {
      it.source = 'teks';
      it.note = r.status === 'galat'
        ? 'Database sedang tidak dapat dihubungi; data dibaca dari teks Anda (kuota referensi ini dikembalikan).'
        : `Tidak ada data yang cocok di database (${r.label}). Data dibaca dari teks Anda; lengkapi lewat tombol Edit bila perlu.`;
    }
  }

  // ---------------------------------------------------------------------------
  // Tampilan
  // ---------------------------------------------------------------------------
  const CATS = [
    { key: 'all', label: 'Semua', test: () => true },
    { key: 'needs', label: 'Perlu ditinjau', test: (it) => it.issues && it.issues.length > 0 && !it.fixed && !it.good },
    { key: 'fixed', label: 'Sudah diperbaiki', test: (it) => it.fixed },
    { key: 'good', label: 'Dari awal sesuai', test: (it) => it.good },
  ];

  function render() {
    $('st-out').hidden = false;
    const st = currentStyle();

    // Ringkasan / filter
    const sum = $('st-summary');
    sum.replaceChildren(...CATS.map((c) => {
      const b = el('button', 'stat' + (filter === c.key ? ' active' : ''));
      b.append(el('b', null, String(items.filter(c.test).length)), el('span', null, c.label));
      b.onclick = () => { filter = c.key; render(); };
      return b;
    }));

    // Kartu
    const box = $('st-cards');
    box.replaceChildren();
    const cat = CATS.find((c) => c.key === filter);
    const list = items.map((it, i) => [it, i]).filter(([it]) => cat.test(it));
    if (!list.length) box.append(el('div', 'empty', 'Tidak ada referensi pada kategori ini.'));
    for (const [it, i] of list) box.append(card(it, i, st));

    // Daftar lengkap
    $('st-final-style').textContent = st.name;
    const fl = $('st-list');
    fl.replaceChildren(...order.map((i) => { const p = el('p'); p.innerHTML = items[i].html || ''; return p; }));
  }

  function card(it, i, st) {
    const c = el('div', 'st-card' + (it.fixed ? ' fixed' : ''));
    const head = el('div', 'st-card-head');
    const left = el('div');
    left.append(el('b', null, `Referensi #${i + 1}`), ' ', el('span', 'chip', typeName(it.csl && it.csl.type)));
    let badge;
    if (it.fixed) badge = el('span', 'chip ok', 'Sudah diperbaiki');
    else if (it.good) badge = el('span', 'chip ok', 'Dari awal sesuai');
    else if (it.issues && it.issues.length) badge = el('span', 'chip warn', 'Perlu ditinjau');
    else badge = el('span', 'chip', 'Diformat ulang');
    head.append(left, badge);
    c.append(head);

    const grid = el('div', 'st-grid');

    // Kolom asli
    const orig = el('div', 'st-pane');
    const oh = el('div', 'st-pane-head');
    oh.append(el('span', null, 'Asli'));
    const links = el('span', 'st-meta');
    const q = (it.csl && it.csl.title) || it.text;
    const gs = el('a', null, 'Google Scholar');
    gs.href = 'https://scholar.google.com/scholar?q=' + encodeURIComponent(q.slice(0, 250)); gs.target = '_blank'; gs.rel = 'noopener';
    links.append(gs);
    if (it.csl && it.csl.DOI) {
      const d = el('a', null, 'Buka DOI');
      d.href = 'https://doi.org/' + it.csl.DOI; d.target = '_blank'; d.rel = 'noopener';
      links.append(' · ', d);
    }
    oh.append(links);
    orig.append(oh, el('div', 'st-text st-orig', it.text));

    // Kolom hasil
    const fixed = el('div', 'st-pane');
    const fh = el('div', 'st-pane-head');
    fh.append(el('span', null, `Hasil — ${st.name}`));
    const src = it.source === 'teks'
      ? el('span', 'chip warn', 'Dari teks Anda')
      : it.source === 'edit' ? el('span', 'chip', 'Diedit manual') : el('span', 'chip ok', `Terdata: ${it.source}`);
    fh.append(src);
    const out = el('div', 'st-text');
    out.innerHTML = it.html || '';
    fixed.append(fh, out);
    if (it.issues && it.issues.length && !it.fixed) {
      const ul = el('ul', 'st-issues');
      it.issues.forEach((x) => ul.append(el('li', null, x)));
      fixed.append(ul);
    }
    if (it.note) fixed.append(el('div', 'note', it.note));

    grid.append(orig, fixed);
    c.append(grid);

    // Aksi
    const acts = el('div', 'st-acts');
    const btn = (label, fn, cls) => { const b = el('button', cls || null, label); b.type = 'button'; b.onclick = () => fn(b); return b; };
    if (it.similar) {
      acts.append(btn(`Pakai data ${it.similar.source}`, () => {
        it.csl = it.similar.csl; it.source = it.similar.source; it.verified = true; it.fixed = true; it.similar = null;
        it.note = `Data diambil dari ${it.source}.`;
        reformat();
      }));
    }
    acts.append(
      btn(editing === i ? 'Tutup edit' : 'Edit', () => { editing = editing === i ? null : i; render(); }),
      btn(it.fixed ? 'Batalkan tanda beres' : 'Tandai beres', () => { it.fixed = !it.fixed; it.good = false; render(); }),
      btn('Salin', async (b) => { const ok = await copyRich(wordHtml([i]), it.plain); flash(b, ok ? 'Tersalin ✓' : 'Gagal'); }),
    );
    c.append(acts);
    if (editing === i) c.append(editForm(it, i));
    return c;
  }

  function flash(b, text) {
    const old = b.textContent;
    b.textContent = text;
    setTimeout(() => { b.textContent = old; }, 1600);
  }

  // ---------------------------------------------------------------------------
  // Edit manual
  // ---------------------------------------------------------------------------
  const nameLine = (a) => (a.literal ? a.literal : a.given ? `${a.family}, ${a.given}` : a.family || '');
  function parseNames(text) {
    return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      if (l.includes(',')) { const [family, ...g] = l.split(','); return { family: family.trim(), given: g.join(',').trim() || undefined }; }
      return l.split(/\s+/).length > 1 ? { literal: l } : { family: l };
    });
  }

  function editForm(it, i) {
    const c = it.csl || {};
    const box = el('div', 'st-edit open');
    const grid = el('div', 'grid');
    const field = (label, key, value, opts = {}) => {
      const l = el('label', opts.wide ? 'wide' : null, label);
      let inp;
      if (opts.textarea) { inp = el('textarea'); inp.value = value || ''; }
      else if (opts.select) {
        inp = el('select');
        opts.select.forEach(([v, t]) => { const o = el('option', null, t); o.value = v; inp.append(o); });
        inp.value = value || opts.select[0][0];
      } else { inp = el('input'); inp.value = value || ''; if (opts.placeholder) inp.placeholder = opts.placeholder; }
      inp.dataset.key = key;
      l.append(inp);
      grid.append(l);
      return inp;
    };
    const year = c.issued && c.issued['date-parts'] ? c.issued['date-parts'][0][0] : '';
    const typeSel = field('Jenis karya', 'type', c.type || 'article-journal', { select: TYPES });
    field('Penulis (satu per baris: Nama Belakang, Nama Depan — atau nama lembaga)', 'author', (c.author || []).map(nameLine).join('\n'), { wide: true, textarea: true });
    field('Tahun', 'year', year, { placeholder: 'mis. 2024' });
    field('Judul', 'title', c.title, { wide: true });
    const container = field('Nama jurnal / prosiding / judul buku induk', 'container-title', c['container-title'], { wide: true });
    field('Volume', 'volume', c.volume);
    field('Nomor (issue)', 'issue', c.issue);
    field('Halaman', 'page', c.page, { placeholder: 'mis. 15-29' });
    field('Editor buku (satu per baris)', 'editor', (c.editor || []).map(nameLine).join('\n'), { wide: true, textarea: true });
    field('Penerbit / institusi', 'publisher', c.publisher, { placeholder: 'mis. Alfabeta, Universitas ...' });
    field('Kota terbit', 'publisher-place', c['publisher-place']);
    field('Edisi', 'edition', c.edition, { placeholder: 'mis. 2 atau Edisi revisi' });
    field('Jenis tesis', 'genre', c.genre, { placeholder: 'Skripsi / Tesis / Disertasi' });
    field('DOI', 'DOI', c.DOI, { placeholder: '10.xxxx/...' });
    field('URL (bila tidak ada DOI)', 'URL', c.URL, { wide: true });
    box.append(grid);

    const toggle = () => {
      const t = typeSel.value;
      grid.querySelectorAll('[data-key]').forEach((inp) => {
        const k = inp.dataset.key;
        const show =
          ['type', 'author', 'year', 'title', 'DOI', 'URL'].includes(k) ||
          (k === 'container-title' && ['article-journal', 'paper-conference', 'chapter'].includes(t)) ||
          (['volume', 'issue'].includes(k) && t === 'article-journal') ||
          (k === 'page' && ['article-journal', 'paper-conference', 'chapter'].includes(t)) ||
          (k === 'editor' && t === 'chapter') ||
          (['publisher', 'publisher-place'].includes(k) && ['book', 'chapter', 'thesis', 'report', 'paper-conference'].includes(t)) ||
          (k === 'edition' && ['book', 'chapter'].includes(t)) ||
          (k === 'genre' && t === 'thesis');
        inp.parentElement.style.display = show ? '' : 'none';
      });
      container.parentElement.firstChild.textContent = t === 'chapter' ? 'Judul buku induk' : t === 'paper-conference' ? 'Nama prosiding / konferensi' : 'Nama jurnal';
    };
    typeSel.addEventListener('change', toggle);
    toggle();

    const acts = el('div', 'st-acts');
    const save = el('button', 'primary small', 'Terapkan');
    save.type = 'button';
    save.onclick = () => {
      const v = {};
      grid.querySelectorAll('[data-key]').forEach((inp) => {
        if (inp.parentElement.style.display !== 'none') v[inp.dataset.key] = inp.value.trim();
      });
      const csl = { type: v.type, language: c.language };
      if (v.title) csl.title = v.title;
      const auth = parseNames(v.author); if (auth.length) csl.author = auth;
      const ed = parseNames(v.editor); if (ed.length) csl.editor = ed;
      if (/^\d{4}$/.test(v.year || '')) csl.issued = { 'date-parts': [[Number(v.year)]] };
      for (const k of ['container-title', 'volume', 'issue', 'page', 'publisher', 'publisher-place', 'edition', 'genre', 'DOI', 'URL']) if (v[k]) csl[k] = v[k];
      it.csl = csl; it.source = 'edit'; it.fixed = true; it.good = false; it.note = 'Diedit manual.';
      editing = null;
      reformat();
    };
    const cancel = el('button', 'small', 'Batal');
    cancel.type = 'button';
    cancel.onclick = () => { editing = null; render(); };
    acts.append(save, cancel);
    box.append(acts);
    return box;
  }

  // ---------------------------------------------------------------------------
  // Salin & unduh
  // ---------------------------------------------------------------------------
  function wordHtml(indexes) {
    const numeric = currentStyle().numeric;
    const ps = indexes.map((i) => `<p style="margin:0 0 0 0.5in;text-indent:-0.5in;line-height:200%;font-family:'Times New Roman',serif;font-size:12pt">${items[i].html || ''}</p>`);
    return `<html><body>${numeric ? ps.join('') : ps.join('')}</body></html>`;
  }

  async function copyRich(html, text) {
    try {
      if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })]);
        return true;
      }
    } catch { /* coba cara lain */ }
    try {
      const d = el('div');
      d.contentEditable = 'true';
      d.style.cssText = 'position:fixed;left:-9999px;top:0;';
      d.innerHTML = html;
      document.body.append(d);
      const r = document.createRange(); r.selectNodeContents(d);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      const ok = document.execCommand('copy');
      s.removeAllRanges(); d.remove();
      return ok;
    } catch { return false; }
  }

  $('st-copyword').onclick = async () => {
    const ok = await copyRich(wordHtml(order), order.map((i) => items[i].plain).join('\n'));
    flash($('st-copyword'), ok ? 'Tersalin ✓ — tempel di Word' : 'Gagal menyalin');
  };
  $('st-copytext').onclick = async () => {
    try { await navigator.clipboard.writeText(order.map((i) => items[i].plain).join('\n')); flash($('st-copytext'), 'Tersalin ✓'); }
    catch { flash($('st-copytext'), 'Gagal menyalin'); }
  };

  function rtfEscape(s) {
    let out = '';
    for (const ch of s) {
      const code = ch.codePointAt(0);
      if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch;
      else if (code > 127) {
        if (code > 0xffff) {
          const hi = Math.floor((code - 0x10000) / 0x400) + 0xd800, lo = ((code - 0x10000) % 0x400) + 0xdc00;
          out += `\\u${hi - 65536}?\\u${lo - 65536}?`;
        } else out += `\\u${code > 32767 ? code - 65536 : code}?`;
      } else out += ch;
    }
    return out;
  }
  function htmlToRtf(html) {
    const d = document.createElement('div');
    d.innerHTML = safeHtml(html);
    const walk = (node) => {
      let s = '';
      for (const n of node.childNodes) {
        if (n.nodeType === 3) s += rtfEscape(n.nodeValue);
        else if (n.nodeType === 1) {
          const tag = n.tagName.toLowerCase();
          const ctl = { i: '\\i ', em: '\\i ', b: '\\b ', strong: '\\b ', sup: '\\super ', sub: '\\sub ' }[tag] || '';
          s += `{${ctl}${walk(n)}}`;
        }
      }
      return s;
    };
    return walk(d);
  }
  $('st-rtf').onclick = () => {
    const body = order.map((i) => `\\pard\\li720\\fi-720\\sl480\\slmult1\\sa0 ${htmlToRtf(items[i].html || '')}\\par`).join('\n');
    const rtf = `{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}}\\f0\\fs24\n${body}\n}`;
    const blob = new Blob([rtf], { type: 'application/rtf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `daftar-pustaka-${currentStyle().id}.rtf`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
})();
