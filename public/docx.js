/* Rujuk — membaca file .docx langsung di browser (tanpa mengunggah ke server).
   Mengambil teks naskah, catatan kaki, dan catatan akhir. */
(function (root) {
  'use strict';

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

  // ---------- Pembaca ZIP minimal ----------
  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }

  function listEntries(buf) {
    const v = new DataView(buf);
    const min = Math.max(0, buf.byteLength - 65557);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= min; i--) {
      if (u32(v, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Bukan file .docx yang valid.');
    const count = u16(v, eocd + 10);
    let p = u32(v, eocd + 16);
    const entries = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (u32(v, p) !== 0x02014b50) throw new Error('Struktur file .docx rusak.');
      const method = u16(v, p + 10);
      const compSize = u32(v, p + 20);
      const nameLen = u16(v, p + 28);
      const extraLen = u16(v, p + 30);
      const commentLen = u16(v, p + 32);
      const local = u32(v, p + 42);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      entries[name] = { method, compSize, local };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function readEntry(buf, e) {
    const v = new DataView(buf);
    const start = e.local + 30 + u16(v, e.local + 26) + u16(v, e.local + 28);
    const data = new Uint8Array(buf, start, e.compSize);
    let bytes;
    if (e.method === 0) bytes = data;
    else if (e.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('Browser ini belum mendukung pembacaan .docx. Gunakan versi terbaru Chrome, Edge, Firefox, atau Safari.');
      }
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else throw new Error('Metode kompresi .docx tidak didukung.');
    return new TextDecoder('utf-8').decode(bytes);
  }

  // ---------- XML Word -> teks ----------
  function insideFallback(el) {
    for (let n = el.parentNode; n; n = n.parentNode) if (n.localName === 'Fallback') return true;
    return false;
  }

  function paragraphText(p) {
    let out = '';
    const walk = (node) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType !== 1) continue;
        const ln = ch.localName;
        if (ln === 'Fallback') continue;
        if (ch.namespaceURI === W) {
          if (ln === 'p') continue; // paragraf bersarang (kotak teks) dibaca terpisah
          if (ln === 'del' || ln === 'delText' || ln === 'instrText' || ln === 'footnoteReference' || ln === 'endnoteReference') continue;
          if (ln === 't') { out += ch.textContent; continue; }
          if (ln === 'tab') { out += '\t'; continue; }
          if (ln === 'br' || ln === 'cr') { out += '\n'; continue; }
          if (ln === 'noBreakHyphen') { out += '-'; continue; }
        }
        walk(ch);
      }
    };
    walk(p);
    return out;
  }

  function paragraphsOf(node) {
    const out = [];
    const ps = node.getElementsByTagNameNS(W, 'p');
    for (const p of ps) {
      if (insideFallback(p)) continue;
      out.push(paragraphText(p));
    }
    return out;
  }

  function parseXml(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Isi dokumen tidak dapat dibaca.');
    return doc;
  }

  function notesFrom(xml, tag) {
    if (!xml) return [];
    const doc = parseXml(xml);
    const out = [];
    for (const n of doc.getElementsByTagNameNS(W, tag)) {
      const type = n.getAttributeNS(W, 'type') || n.getAttribute('w:type');
      if (type === 'separator' || type === 'continuationSeparator' || type === 'continuationNotice') continue;
      const text = paragraphsOf(n).join(' ').replace(/\s+/g, ' ').trim();
      if (text) out.push(text);
    }
    return out;
  }

  async function read(file) {
    if (!/\.docx$/i.test(file.name)) {
      throw new Error(/\.doc$/i.test(file.name)
        ? 'Format .doc lama belum didukung. Buka di Word lalu simpan sebagai .docx.'
        : 'Hanya file .docx yang didukung.');
    }
    const buf = await file.arrayBuffer();
    const entries = listEntries(buf);
    if (!entries['word/document.xml']) throw new Error('Isi dokumen Word tidak ditemukan di file ini.');
    const [docXml, fnXml, enXml] = await Promise.all([
      readEntry(buf, entries['word/document.xml']),
      entries['word/footnotes.xml'] ? readEntry(buf, entries['word/footnotes.xml']) : null,
      entries['word/endnotes.xml'] ? readEntry(buf, entries['word/endnotes.xml']) : null,
    ]);
    const doc = parseXml(docXml);
    const body = doc.getElementsByTagNameNS(W, 'body')[0] || doc;
    const text = paragraphsOf(body).join('\n').replace(/\n{3,}/g, '\n\n');
    const notes = [...notesFrom(fnXml, 'footnote'), ...notesFrom(enXml, 'endnote')];
    const words = (text.match(/\S+/g) || []).length;
    return { text, notes, words, name: file.name };
  }

  root.DocxText = { read };
})(typeof self !== 'undefined' ? self : this);
