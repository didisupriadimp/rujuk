/* Rujuk — pencocokan sitasi dalam naskah dengan daftar pustaka.
   Berjalan di browser (window.CiteCheck) dan di Node (module.exports) untuk pengujian. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CiteCheck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Utilitas nama ----------
  const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'du', 'di', 'da', 'del', 'della', 'la', 'le', 'al', 'el', 'bin', 'binti', 'ibn', 'dos', 'das', 'ter', 'ten', 'mc', 'st']);
  // Kata berhuruf besar di awal kalimat yang bukan nama
  const LEAD_WORDS = new Set([
    'menurut', 'dalam', 'hal', 'ini', 'itu', 'hasil', 'penelitian', 'studi', 'kajian', 'berdasarkan', 'seperti', 'sebagaimana',
    'pendapat', 'teori', 'model', 'konsep', 'definisi', 'pengertian', 'selain', 'sementara', 'namun', 'akan', 'tetapi', 'oleh',
    'karena', 'sedangkan', 'adapun', 'kemudian', 'selanjutnya', 'lebih', 'lanjut', 'juga', 'pula', 'para', 'ahli', 'peneliti',
    'dijelaskan', 'menjelaskan', 'mengemukakan', 'menyatakan', 'mendefinisikan', 'temuan', 'riset', 'buku', 'artikel', 'bahwa',
    'according', 'to', 'in', 'as', 'the', 'this', 'that', 'these', 'those', 'however', 'moreover', 'furthermore', 'while', 'study',
    'studies', 'research', 'findings', 'similarly', 'following', 'based', 'on', 'by', 'for', 'and', 'also', 'recent', 'previous',
    'lihat', 'see', 'eg', 'cf', 'misalnya', 'contohnya', 'yaitu', 'yakni', 'antara', 'lain', 'tabel', 'gambar', 'table', 'figure',
  ]);

  function norm(s) {
    return String(s || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function nameTokens(s) {
    return norm(s).split(' ').filter((t) => t && !/^\d+$/.test(t));
  }

  // Kunci nama: token terakhir yang bukan partikel (mis. "van der Berg" -> "berg", "Al Harrasi" -> "harrasi")
  function nameKey(s) {
    const t = nameTokens(s).filter((x) => !PARTICLES.has(x));
    return t.length ? t[t.length - 1] : '';
  }

  function stripLeadWords(name) {
    const parts = String(name).trim().split(/\s+/);
    while (parts.length > 1 && LEAD_WORDS.has(norm(parts[0]))) parts.shift();
    return parts.join(' ');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  // ---------- Tahun ----------
  const YEAR_SRC = '(?:\\d{4}[a-z]?|n\\.\\s?d\\.|t\\.\\s?t\\.|tanpa tahun|in press|dalam proses|forthcoming)';
  function yearKey(y) {
    const s = String(y || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (/^n\.\s?d\.$|^t\.\s?t\.$|tanpa tahun/.test(s)) return 'nd';
    if (/in press|dalam proses|forthcoming/.test(s)) return 'inpress';
    const m = s.match(/^(\d{4})([a-z]?)$/);
    return m ? m[1] + m[2] : s;
  }
  const yearBase = (k) => String(k).replace(/[a-z]$/, '');

  // ---------- Memisahkan naskah dan daftar pustaka ----------
  const HEADING = /^[ \t]*(?:[IVX]+\.|\d+\.)?[ \t]*(daftar[ \t]+pustaka|daftar[ \t]+referensi|daftar[ \t]+rujukan|referensi|references|reference[ \t]+list|bibliography|bibliografi|kepustakaan|rujukan|works[ \t]+cited)[ \t]*:?[ \t]*$/gim;
  const AFTER_REFS = /^[ \t]*(lampiran|appendix|appendices|biodata|riwayat[ \t]+hidup|curriculum[ \t]+vitae)\b.*$/im;

  function splitManuscript(text) {
    const src = String(text || '').replace(/\r/g, '');
    let last = null;
    let m;
    HEADING.lastIndex = 0;
    while ((m = HEADING.exec(src))) last = m;
    if (!last) return { body: src, refs: '' };
    let refs = src.slice(last.index + last[0].length);
    const end = refs.match(AFTER_REFS);
    if (end) refs = refs.slice(0, end.index);
    return { body: src.slice(0, last.index), refs: refs.trim() };
  }

  // ---------- Memecah daftar pustaka ----------
  const NUM = /^(?:\[(\d+)\]|(\d+)[.)])\s+/;
  // Awal sebuah referensi: nama/nomor, lalu tahun dalam 150 karakter pertama
  const REF_START = /^(?:\[\d+\]|\d+[.)]|[\p{Lu}])[^\n]{0,150}?(?:\(\s*(?:\d{4}|n\.\s?d\.|t\.\s?t\.)|\b(?:19|20)\d{2}\b)/u;
  function splitRefs(text) {
    text = String(text || '').replace(/\r/g, '').trim();
    if (!text) return [];
    let parts;
    if (/\n\s*\n/.test(text)) {
      parts = [];
      for (const chunk of text.split(/\n\s*\n/)) {
        const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
        // Satu paragraf per referensi (mis. dari .docx) tanpa baris kosong di antaranya
        if (lines.length > 1 && lines.every((l) => REF_START.test(l))) parts.push(...lines);
        else parts.push(chunk);
      }
    } else {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      const numbered = lines.filter((l) => NUM.test(l)).length;
      if (numbered >= 2 && numbered < lines.length) {
        parts = [];
        for (const l of lines) {
          if (NUM.test(l) || !parts.length) parts.push(l); else parts[parts.length - 1] += ' ' + l;
        }
      } else parts = lines;
    }
    const out = [];
    for (const p of parts) {
      const clean = p.replace(/\s+/g, ' ').trim();
      const nm = clean.match(NUM);
      const t = clean.replace(NUM, '').trim();
      if (t.length <= 20 || /^(daftar pustaka|referensi|references|bibliography|kepustakaan)$/i.test(t)) continue;
      out.push({ text: t, num: nm ? Number(nm[1] || nm[2]) : null });
    }
    return out;
  }

  // ---------- Membaca penulis & tahun dari satu referensi ----------
  function parseRefAuthors(text) {
    const t = String(text);
    let authorPart = null;
    let yk = null;

    // APA: Penulis. (2019a). Judul...
    let m = t.match(new RegExp('^(.*?)\\(\\s*(' + YEAR_SRC + ')\\s*(?:,[^)]*)?\\)', 'i'));
    // Tahun dalam kurung setelah judul (Chicago: "... Journal 11, no. 4 (2000)") bukan pola APA
    if (m && m[1].trim().length && !/["“”]|\bno\.\s*\d/.test(m[1]) && m[1].length <= 200) {
      authorPart = m[1];
      yk = yearKey(m[2]);
    } else {
      // Harvard: Penulis, 2019. Judul... / Penulis. 2019. Judul...
      m = t.match(new RegExp('^(.*?)[,.]\\s*(' + YEAR_SRC + ')[.,]\\s', 'i'));
      if (m) { authorPart = m[1]; yk = yearKey(m[2]); }
    }
    if (!authorPart || /["“”]/.test(authorPart)) {
      // Chicago/Turabian: Nama, Nama Depan. Judul. Kota: Penerbit, 2019.
      const first = t.match(/^(.{2,120}?)\.\s+[\p{Lu}"“]/u);
      const years = t.match(/\b(?:19|20)\d{2}[a-z]?\b/g);
      if (!first) return { authors: [], yearKey: null, firstRaw: '' };
      authorPart = first[1];
      yk = years ? yearKey(years[years.length - 1]) : null;
    }

    authorPart = authorPart.replace(/\((?:eds?|ed|penyunting|peny|editor|editors)\.?\)/gi, ' ').replace(/[.,\s]+$/, '');

    // Pola "Nama, I. I." (APA/Harvard)
    const authors = [];
    const re = /(?:^|,|&|\band\b|\bdan\b)\s*([^,&]+?),\s*((?:[A-ZÀ-Þ][a-z]?\.?\s*-?\s*){1,4})(?=,|&|$|\s+(?:and|dan)\b)/g;
    let a;
    while ((a = re.exec(authorPart))) {
      const surname = a[1].replace(/^\s*(?:&|and|dan)\s+/i, '').trim();
      if (surname && /[A-Za-zÀ-ɏ]/.test(surname)) authors.push(surname);
    }
    if (!authors.length) {
      // Nama tunggal / lembaga / nama lengkap tanpa inisial
      authorPart.split(/\s*(?:;|&)\s*/).forEach((x) => {
        const s = x.replace(/[.,\s]+$/, '').trim();
        if (s) authors.push(s);
      });
    }
    const etal = /et al\.?|dkk\.?/i.test(authorPart);
    // "Arikunto, Suharsimi" -> nama belakang "Arikunto"
    let firstRaw = authors[0] || '';
    if (/^[^,]+,\s*[\p{Lu}]/u.test(firstRaw)) firstRaw = firstRaw.split(',')[0].trim();
    return { authors, yearKey: yk, firstRaw, etal, authorCount: etal ? 99 : authors.length };
  }

  // ---------- Mengambil sitasi dari naskah ----------
  const UP = 'A-Z\\u00C0-\\u00DE';
  const NAME_WORD = '(?:(?:van|von|de|der|den|du|di|da|del|della|la|le|al|el|Al|El|bin|binti|ibn|dos|das|ter|ten)\\s+)*[' + UP + '][\\p{L}\'’\\-]+';
  const NAMES = NAME_WORD + '(?:\\s+' + NAME_WORD + '){0,4}';
  const NARRATIVE_TAIL = new RegExp(
    '(' + NAMES + ')' +
    '(?:\\s*,\\s*(' + NAMES + '))*' +
    '(?:\\s*,?\\s*(?:&|and|dan)\\s+(' + NAMES + '))?' +
    '(\\s+(?:et\\s*al\\.?|dkk\\.?|et\\.\\s*al\\.?))?' +
    '(?:[\'’]s)?\\s*$', 'u');

  function contextAt(text, index, len) {
    const start = Math.max(0, index - 70);
    const end = Math.min(text.length, index + len + 70);
    return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
  }

  function parseAuthorString(s) {
    const etal = /\bet\.?\s*al\.?|\bdkk\.?/i.test(s);
    const clean = s.replace(/\bet\.?\s*al\.?|\bdkk\.?/gi, '').replace(/['’]s\b/g, '').trim().replace(/[,\s]+$/, '');
    const names = clean.split(/\s*(?:,|&|\band\b|\bdan\b)\s*/).map((x) => x.trim()).filter(Boolean);
    return { names, etal };
  }

  function validName(s) {
    return /[A-Za-zÀ-ɏ]{2,}/.test(s) && !/\d|=|<|>|%|:/.test(s) && s.length <= 120;
  }

  function extractCitations(body) {
    const text = String(body || '');
    const cites = [];
    const parenRe = /\(([^()]{1,400})\)/g;
    let m;
    while ((m = parenRe.exec(text))) {
      const inner = m[1];
      if (!new RegExp(YEAR_SRC, 'i').test(inner)) continue;

      // Naratif: Nama (2019) / Nama (2019, hlm. 3) / Nama (2019, 2020)
      const lead = inner.match(new RegExp('^\\s*(' + YEAR_SRC + '(?:\\s*[,;]\\s*' + YEAR_SRC + ')*)(?=\\s*(?:[,:;]|$))', 'i'));
      if (lead) {
        const before = text.slice(Math.max(0, m.index - 160), m.index);
        const nt = before.match(NARRATIVE_TAIL);
        if (nt) {
          const raw = stripLeadWords(nt[0].trim());
          const { names, etal } = parseAuthorString(raw);
          if (names.length && validName(names[0]) && !LEAD_WORDS.has(norm(names[0]))) {
            const years = lead[1].split(/\s*[,;]\s*/).map(yearKey);
            for (const yk of years) {
              cites.push({ kind: 'naratif', raw: `${raw} (${yk === 'nd' ? 'n.d.' : yk})`, names, etal, yearKey: yk, index: m.index, context: contextAt(text, m.index - raw.length, raw.length + m[0].length) });
            }
          }
        }
        continue;
      }

      // Dalam kurung: (Nama, 2019; Nama & Nama, 2020a, 2020b)
      let prevNames = null;
      let prevEtal = false;
      for (let seg of inner.split(';')) {
        seg = seg.trim().replace(/^(?:lihat(?:\s+juga)?|see(?:\s+also)?|e\.g\.,?|i\.e\.,?|cf\.|misalnya|contohnya|dalam|seperti|dikutip\s+dalam|as\s+cited\s+in)\s+/i, '');
        const sm = seg.match(new RegExp('^(.*?)(?:,\\s*|\\s+)(' + YEAR_SRC + '(?:\\s*,\\s*' + YEAR_SRC + ')*)(?=\\s*(?:[,:]|$))', 'i'));
        let names, etal, yearsStr;
        if (sm && sm[1].trim()) {
          ({ names, etal } = parseAuthorString(sm[1]));
          yearsStr = sm[2];
        } else {
          const only = seg.match(new RegExp('^(' + YEAR_SRC + '(?:\\s*,\\s*' + YEAR_SRC + ')*)(?=\\s*(?:[,:]|$))', 'i'));
          if (!only || !prevNames) continue;
          names = prevNames; etal = prevEtal; yearsStr = only[1];
        }
        if (!names.length || !validName(names[0])) continue;
        prevNames = names; prevEtal = etal;
        for (const y of yearsStr.split(/\s*,\s*/)) {
          const yk = yearKey(y);
          const label = names.length > 2 || etal ? `${names[0]} et al.` : names.join(' & ');
          cites.push({ kind: 'kurung', raw: `(${label}, ${yk === 'nd' ? 'n.d.' : yk})`, names, etal, yearKey: yk, index: m.index, context: contextAt(text, m.index, m[0].length) });
        }
      }
    }
    return cites;
  }

  // ---------- Sitasi di catatan kaki ----------
  // Mendukung sitasi penulis-tahun di catatan kaki dan format catatan kaki (Chicago/Turabian):
  // "Sugiyono, Metode Penelitian (Bandung: Alfabeta, 2019), 45."  /  "Lexy J. Moleong, Metodologi..., 2017."
  function extractNoteCitations(notes) {
    const out = [];
    (notes || []).forEach((note, ni) => {
      const text = String(note || '');
      if (/^\s*(ibid|ibidem|id\.|op\.?\s*cit|loc\.?\s*cit)\b/i.test(text)) return;
      const ay = extractCitations(text);
      if (ay.length) {
        ay.forEach((c) => out.push(Object.assign(c, { kind: 'catatan kaki', context: `Catatan kaki ${ni + 1}: ${c.context}` })));
        return;
      }
      for (let seg of text.split(';')) {
        seg = seg.trim().replace(/^(?:lihat(?:\s+juga)?|see(?:\s+also)?|cf\.|bandingkan|bdk\.)\s+/i, '');
        if (/^(ibid|ibidem|op\.?\s*cit|loc\.?\s*cit)\b/i.test(seg)) continue;
        const nm = seg.match(/^([^,]{2,80}?),/);
        if (!nm) continue;
        const { names, etal } = parseAuthorString(nm[1].replace(/\s+(?:dan|and)\s+/gi, ' & '));
        if (!names.length || !validName(names[0]) || !/^[\p{Lu}]/u.test(names[0]) || names[0].split(/\s+/).length > 5) continue;
        const ym = seg.match(/\([^()]*?\b((?:19|20)\d{2}[a-z]?)\)/) || seg.match(/,\s*((?:19|20)\d{2}[a-z]?)\s*(?:[,.]|$)/);
        const yk = ym ? yearKey(ym[1]) : null;
        out.push({
          kind: 'catatan kaki', names, etal, yearKey: yk,
          raw: `${names[0]}${yk ? ' (' + yk + ')' : ''} — catatan kaki ${ni + 1}`,
          context: `Catatan kaki ${ni + 1}: ${seg.length > 200 ? seg.slice(0, 200) + '…' : seg}`,
        });
      }
    });
    return out;
  }

  // ---------- Sitasi bernomor [1], [2-4] ----------
  function extractNumeric(body) {
    const text = String(body || '');
    const out = [];
    const re = /\[\s*(\d+(?:\s*[-–,]\s*\d+)*)\s*\]/g;
    let m;
    while ((m = re.exec(text))) {
      const nums = [];
      for (const part of m[1].split(/\s*,\s*/)) {
        const r = part.split(/\s*[-–]\s*/).map(Number);
        if (r.length === 2 && r[1] >= r[0] && r[1] - r[0] < 50) for (let i = r[0]; i <= r[1]; i++) nums.push(i);
        else nums.push(r[0]);
      }
      nums.forEach((n) => out.push({ num: n, index: m.index, context: contextAt(text, m.index, m[0].length) }));
    }
    return out;
  }

  // ---------- Pencocokan ----------
  function nameMatches(citeName, ref) {
    const key = nameKey(citeName);
    if (!key) return false;
    const refTokens = new Set(nameTokens(ref.firstRaw));
    if (refTokens.has(key)) return true;
    const refKey = nameKey(ref.firstRaw);
    return !!refKey && new Set(nameTokens(citeName)).has(refKey);
  }

  function secondMatches(cite, ref) {
    if (cite.names.length < 2 || ref.authors.length < 2) return true;
    const key = nameKey(cite.names[1]);
    return nameTokens(ref.authors[1]).includes(key);
  }

  function formatNotes(cite, ref) {
    const notes = [];
    const n = ref.authorCount;
    if (!n || n === 99) return notes;
    if (n === 2 && cite.names.length < 2 && !cite.etal) notes.push(`Referensi ini punya 2 penulis; sitasi hanya menyebut satu (APA: sebutkan keduanya).`);
    if (n <= 2 && cite.etal) notes.push(`Referensi ini punya ${n} penulis; "et al."/"dkk." dipakai untuk 3 penulis atau lebih.`);
    return notes;
  }

  function compare(manuscript, refsText, opts) {
    const refs = splitRefs(refsText).map((r, i) => Object.assign({ index: i, no: r.num || i + 1 }, r, parseRefAuthors(r.text)));
    const noteCites = extractNoteCitations(opts && opts.notes);
    const authorYear = extractCitations(manuscript).concat(noteCites);
    const numeric = extractNumeric(manuscript);
    const mode = numeric.length >= 2 && numeric.length > authorYear.length ? 'nomor' : 'penulis-tahun';

    const refState = refs.map(() => ({ count: 0, cites: new Set() }));

    if (mode === 'nomor') {
      const byNo = new Map(refs.map((r, i) => [r.no, i]));
      const missing = new Map();
      for (const c of numeric) {
        const i = byNo.get(c.num);
        if (i === undefined) {
          const k = String(c.num);
          if (!missing.has(k)) missing.set(k, { label: `[${c.num}]`, count: 0, contexts: [], suggestion: null });
          const x = missing.get(k); x.count++; if (x.contexts.length < 3) x.contexts.push(c.context);
        } else { refState[i].count++; }
      }
      return finish(mode, refs, refState, [...missing.values()], [], numeric.length);
    }

    const groups = new Map(); // satu entri per sitasi unik
    for (const c of authorYear) {
      const k = nameKey(c.names[0]) + '|' + c.yearKey + '|' + (c.names[1] ? nameKey(c.names[1]) : '') + (c.yearKey ? '' : '|' + c.raw);
      if (!groups.has(k)) groups.set(k, { cite: c, count: 0, contexts: [] });
      const g = groups.get(k); g.count++; if (g.contexts.length < 3) g.contexts.push(c.context);
    }

    const missing = [];
    const warnings = [];
    for (const g of groups.values()) {
      const c = g.cite;
      const byName = refs.filter((r) => nameMatches(c.names[0], r));
      // Catatan kaki singkat tanpa tahun: cukup cocok nama
      let hits = c.yearKey ? byName.filter((r) => r.yearKey === c.yearKey) : byName.slice();
      if (hits.length > 1) {
        const strict = hits.filter((r) => secondMatches(c, r));
        if (strict.length) hits = strict;
      }
      if (hits.length) {
        hits.forEach((r) => { refState[r.index].count += g.count; refState[r.index].cites.add(c.raw); });
        const notes = formatNotes(c, hits[0]);
        if (notes.length) warnings.push({ label: c.raw, count: g.count, contexts: g.contexts, notes, ref: hits[0].text });
        continue;
      }
      // Tahun cocok tanpa huruf (2019 vs 2019a)
      const loose = c.yearKey ? byName.filter((r) => r.yearKey && yearBase(r.yearKey) === yearBase(c.yearKey)) : [];
      if (loose.length) {
        loose.forEach((r) => { refState[r.index].count += g.count; refState[r.index].cites.add(c.raw); });
        warnings.push({ label: c.raw, count: g.count, contexts: g.contexts, notes: [`Huruf tahun tidak konsisten: di naskah ${c.yearKey}, di daftar pustaka ${loose.map((r) => r.yearKey).join(', ')}.`], ref: loose[0].text });
        continue;
      }
      // Tidak ada pasangan: beri saran
      let suggestion = null;
      if (byName.length) {
        suggestion = `Nama ada di daftar pustaka dengan tahun ${byName.map((r) => r.yearKey || '?').join(', ')}. Periksa tahunnya.`;
      } else {
        const key = nameKey(c.names[0]);
        const near = refs.filter((r) => {
          const rk = nameKey(r.firstRaw);
          return rk && key && rk !== key && levenshtein(rk, key) <= (key.length > 6 ? 2 : 1) && (!c.yearKey || !r.yearKey || yearBase(r.yearKey) === yearBase(c.yearKey));
        });
        if (near.length) suggestion = `Mungkin salah ketik nama: di daftar pustaka tertulis "${near[0].firstRaw}"${near[0].yearKey ? ' (' + near[0].yearKey + ')' : ''}.`;
      }
      missing.push({ label: c.raw, count: g.count, contexts: g.contexts, suggestion, yearMismatch: byName.length > 0 });
    }

    const out = finish(mode, refs, refState, missing, warnings, authorYear.length);
    out.noteCites = noteCites.length;
    return out;
  }

  function finish(mode, refs, refState, missing, warnings, totalCites) {
    const uncited = refs.filter((r, i) => refState[i].count === 0).map((r) => ({ no: r.no, text: r.text }));
    const matched = refs.filter((r, i) => refState[i].count > 0).map((r) => ({ no: r.no, text: r.text, count: refState[r.index].count }));
    return { mode, totalCites, refCount: refs.length, missing, uncited, warnings, matched };
  }

  return { splitManuscript, splitRefs, parseRefAuthors, extractCitations, extractNoteCitations, extractNumeric, compare, _nameKey: nameKey };
});
