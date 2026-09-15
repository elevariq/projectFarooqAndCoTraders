/* ══════════════════════════════════════════════════════════════════════════
   FAROOQ & CO TRADERS — ERP UPGRADE · MODULE 3/5
   MICROSOFT WORD OUTPUT  ·  real OOXML, no images, no server
   A small ZIP writer plus a WordprocessingML builder. Everything the document
   shows is live Word content: editable text, editable table cells, editable
   totals. A4 page, repeating table header row, totals kept together,
   page numbers in the footer. (§5 §6 §7)
   ══════════════════════════════════════════════════════════════════════════ */
(function (global) {
'use strict';

/* ── CRC32 ─────────────────────────────────────────────────────────────── */
var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function utf8(str) {
  if (global.TextEncoder) return new global.TextEncoder().encode(str);
  var s = unescape(encodeURIComponent(str)), a = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

/* ── minimal ZIP (stored, no deflate — valid and accepted by Word) ────── */
function zip(files) {
  var chunks = [], central = [], offset = 0;
  var now = new Date();
  var dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xFFFF;
  var dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;

  files.forEach(function (f) {
    var nameBytes = utf8(f.name);
    var data = f.data instanceof Uint8Array ? f.data : utf8(f.data);
    var crc = crc32(data);
    var local = new Uint8Array(30 + nameBytes.length);
    var dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);            // version needed
    dv.setUint16(6, 0x0800, true);        // UTF-8 name flag
    dv.setUint16(8, 0, true);             // stored
    dv.setUint16(10, dosTime, true);
    dv.setUint16(12, dosDate, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    chunks.push(local, data);

    var cen = new Uint8Array(46 + nameBytes.length);
    var cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cen.set(nameBytes, 46);
    central.push(cen);
    offset += local.length + data.length;
  });

  var centralSize = central.reduce(function (a, c) { return a + c.length; }, 0);
  var end = new Uint8Array(22), ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);

  var total = chunks.reduce(function (a, c) { return a + c.length; }, 0) + centralSize + 22;
  var out = new Uint8Array(total), pos = 0;
  chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
  central.forEach(function (c) { out.set(c, pos); pos += c.length; });
  out.set(end, pos);
  return out;
}

/* ── WordprocessingML helpers ─────────────────────────────────────────── */
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
var URDU_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

var W = {
  /* one run; Urdu is detected and marked right-to-left with a complex-script
     font so Word shapes it correctly instead of printing it backwards */
  run: function (text, o) {
    o = o || {};
    var rtl = o.rtl !== undefined ? o.rtl : URDU_RE.test(String(text || ''));
    var sz = (o.size || 18) * 2;                        // half-points
    var props = '<w:rPr>' +
      '<w:rFonts w:ascii="' + (o.font || 'Calibri') + '" w:hAnsi="' + (o.font || 'Calibri') +
        '" w:cs="' + (o.csFont || 'Arial') + '"/>' +
      (o.bold ? '<w:b/><w:bCs/>' : '') +
      (o.italic ? '<w:i/>' : '') +
      (o.caps ? '<w:caps/>' : '') +
      (o.color ? '<w:color w:val="' + o.color + '"/>' : '') +
      (o.spacing ? '<w:spacing w:val="' + o.spacing + '"/>' : '') +
      '<w:sz w:val="' + sz + '"/><w:szCs w:val="' + sz + '"/>' +
      (rtl ? '<w:rtl/>' : '') +
      '</w:rPr>';
    var parts = String(text === null || text === undefined ? '' : text).split('\n');
    return parts.map(function (t, i) {
      return '<w:r>' + props + (i ? '<w:br/>' : '') +
             '<w:t xml:space="preserve">' + esc(t) + '</w:t></w:r>';
    }).join('');
  },
  para: function (runs, o) {
    o = o || {};
    var pPr = '<w:pPr>' +
      (o.style ? '<w:pStyle w:val="' + o.style + '"/>' : '') +
      (o.align ? '<w:jc w:val="' + o.align + '"/>' : '') +
      (o.rtlPara ? '<w:bidi/>' : '') +
      (o.keepNext ? '<w:keepNext/>' : '') +
      (o.keepLines ? '<w:keepLines/>' : '') +
      (o.pageBreakBefore ? '<w:pageBreakBefore/>' : '') +
      '<w:spacing w:before="' + (o.before || 0) + '" w:after="' + (o.after === undefined ? 60 : o.after) +
        '" w:line="' + (o.line || 240) + '" w:lineRule="auto"/>' +
      (o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="' + (o.borderSize || 6) +
        '" w:space="2" w:color="' + (o.borderColor || 'C7C7CF') + '"/></w:pBdr>' : '') +
      (o.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.shade + '"/>' : '') +
      (o.indent ? '<w:ind w:left="' + o.indent + '"/>' : '') +
      '</w:pPr>';
    var body = Array.isArray(runs) ? runs.join('') : runs;
    return '<w:p>' + pPr + body + '</w:p>';
  },
  text: function (t, o) { return W.para(W.run(t, o), o); },
  empty: function (after) { return W.para('', { after: after === undefined ? 80 : after }); },

  cell: function (content, o) {
    o = o || {};
    var borders = o.noBorder ? '' :
      '<w:tcBorders>' +
      ['top', 'left', 'bottom', 'right'].map(function (side) {
        var on = o.sides ? o.sides.indexOf(side[0]) > -1 : true;
        return '<w:' + side + ' w:val="' + (on ? 'single' : 'nil') + '" w:sz="' +
               (o.borderSize || 4) + '" w:space="0" w:color="' + (o.borderColor || 'B9B9C4') + '"/>';
      }).join('') + '</w:tcBorders>';
    return '<w:tc><w:tcPr><w:tcW w:w="' + (o.width || 1000) + '" w:type="dxa"/>' +
      (o.span ? '<w:gridSpan w:val="' + o.span + '"/>' : '') +
      borders +
      (o.fill ? '<w:shd w:val="clear" w:color="auto" w:fill="' + o.fill + '"/>' : '') +
      '<w:tcMar><w:top w:w="' + (o.padV || 40) + '" w:type="dxa"/><w:bottom w:w="' + (o.padV || 40) +
        '" w:type="dxa"/><w:left w:w="' + (o.padH || 70) + '" w:type="dxa"/><w:right w:w="' +
        (o.padH || 70) + '" w:type="dxa"/></w:tcMar>' +
      '<w:vAlign w:val="' + (o.vAlign || 'center') + '"/></w:tcPr>' +
      /* OOXML requires a cell to end in a paragraph. Without this a nested
         table breaks out of its column and the layout collapses. */
      (function (c) {
        c = c || W.empty(0);
        return /<\/w:tbl>\s*$/.test(c) ? c + '<w:p><w:pPr><w:spacing w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>' : c;
      })(content) + '</w:tc>';
  },
  row: function (cells, o) {
    o = o || {};
    return '<w:tr><w:trPr>' +
      (o.header ? '<w:tblHeader/>' : '') +          // repeats on every page (§7)
      (o.cantSplit ? '<w:cantSplit/>' : '') +
      (o.height ? '<w:trHeight w:val="' + o.height + '"/>' : '') +
      '</w:trPr>' + cells.join('') + '</w:tr>';
  },
  table: function (widths, rows, o) {
    o = o || {};
    var total = widths.reduce(function (a, b) { return a + b; }, 0);
    var borders = o.noBorder
      ? '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
          return '<w:' + s + ' w:val="nil"/>'; }).join('') + '</w:tblBorders>'
      : '';
    return '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>' +
      '<w:tblW w:w="' + total + '" w:type="dxa"/>' +
      (o.align ? '<w:jc w:val="' + o.align + '"/>' : '') +
      '<w:tblLayout w:type="fixed"/>' + borders +
      '<w:tblCellMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tblCellMar>' +
      '</w:tblPr><w:tblGrid>' +
      widths.map(function (w) { return '<w:gridCol w:w="' + w + '"/>'; }).join('') +
      '</w:tblGrid>' + rows.join('') + '</w:tbl>';
  }
};
W.esc = esc;

/* A4 portrait, 1.6 cm margins — 9638 dxa of usable width */
var PAGE = { w: 11906, h: 16838, mTop: 850, mBottom: 900, mLeft: 900, mRight: 900 };
var USABLE = PAGE.w - PAGE.mLeft - PAGE.mRight;   // 10106

function documentXml(bodyXml, opts) {
  opts = opts || {};
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<w:body>' + bodyXml +
  '<w:sectPr>' +
  '<w:footerReference w:type="default" r:id="rIdFooter"/>' +
  '<w:pgSz w:w="' + PAGE.w + '" w:h="' + PAGE.h + '"/>' +
  '<w:pgMar w:top="' + PAGE.mTop + '" w:right="' + PAGE.mRight + '" w:bottom="' + PAGE.mBottom +
  '" w:left="' + PAGE.mLeft + '" w:header="360" w:footer="360" w:gutter="0"/>' +
  '<w:cols w:space="708"/><w:docGrid w:linePitch="360"/>' +
  '</w:sectPr></w:body></w:document>';
}

function footerXml(text) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  W.table([USABLE - 2200, 2200], [
    W.row([
      W.cell(W.text(text, { size: 7.5, color: '6B6B78', after: 0 }), { width: USABLE - 2200, noBorder: true, padH: 0 }),
      W.cell('<w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr>' +
        W.run('Page ', { size: 7.5, color: '6B6B78' }) +
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="6B6B78"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="6B6B78"/></w:rPr><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="6B6B78"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>' +
        W.run(' of ', { size: 7.5, color: '6B6B78' }) +
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="6B6B78"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="6B6B78"/></w:rPr><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r>' +
        '<w:r><w:rPr><w:sz w:val="15"/><w:color w:val="6B6B78"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r>' +
        '</w:p>', { width: 2200, noBorder: true, padH: 0 })
    ])
  ], { noBorder: true }) +
  '</w:ftr>';
}

var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
'<w:docDefaults><w:rPrDefault><w:rPr>' +
'<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Arial"/><w:sz w:val="19"/><w:szCs w:val="19"/>' +
'</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr>' +
'<w:spacing w:after="60" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
'<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
'<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>' +
'<w:tblPr><w:tblBorders>' +
['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(function (s) {
  return '<w:' + s + ' w:val="single" w:sz="4" w:space="0" w:color="B9B9C4"/>';
}).join('') +
'</w:tblBorders></w:tblPr></w:style>' +
'</w:styles>';

var CONTENT_TYPES =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
'<Default Extension="xml" ContentType="application/xml"/>' +
'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
'<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
'<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
'<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
'<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
'</Types>';

var ROOT_RELS =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
'</Relationships>';

var DOC_RELS =
'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
'<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
'<Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
'</Relationships>';

function coreXml(title, author) {
  var iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<dc:title>' + esc(title) + '</dc:title>' +
  '<dc:creator>' + esc(author) + '</dc:creator>' +
  '<cp:lastModifiedBy>' + esc(author) + '</cp:lastModifiedBy>' +
  '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created>' +
  '<dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified>' +
  '</cp:coreProperties>';
}
var APP_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
'<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">' +
'<Application>Farooq &amp; Co Traders ERP</Application></Properties>';

function pack(bodyXml, opts) {
  opts = opts || {};
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'docProps/core.xml', data: coreXml(opts.title || 'Document', opts.author || 'Farooq & Co Traders') },
    { name: 'docProps/app.xml', data: APP_XML },
    { name: 'word/_rels/document.xml.rels', data: DOC_RELS },
    { name: 'word/styles.xml', data: STYLES_XML },
    { name: 'word/footer1.xml', data: footerXml(opts.footerText || '') },
    { name: 'word/document.xml', data: documentXml(bodyXml, opts) }
  ]);
}

/* ══════════════════════════════════════════════════════════════════════════
   DOCUMENT COMPOSITION — driven by the shared document model, so the Word
   file, the on-screen A4 preview and the PDF always say the same thing.
   ══════════════════════════════════════════════════════════════════════════ */
var INK = '1A1A24', MUTED = '63636F', ACCENT = '5B21B6', LINE = 'B9B9C4', HEAD_FILL = 'EFECF9';

function headerBlock(m) {
  var b = m.business;
  var left = W.para(W.run(b.logoText || 'F&C', { size: 24, bold: true, color: ACCENT }), { after: 20 }) +
             W.para(W.run(b.name, { size: 15, bold: true, color: INK }), { after: 10 }) +
             W.para(W.run(b.tagline, { size: 8.5, color: MUTED, caps: true, spacing: 20 }), { after: 10 }) +
             (b.slogan ? W.para(W.run(b.slogan, { size: 10, color: ACCENT, rtl: true }), { align: 'left', after: 0 }) : '');
  var lines = [
    b.address, b.city,
    b.phone ? 'Mobile: ' + b.phone : '',
    b.shopPhone ? 'Shop: ' + b.shopPhone : '',
    b.whatsapp ? 'WhatsApp: ' + b.whatsapp : '',
    b.email, b.website,
    b.ntn ? 'NTN: ' + b.ntn : '',
    b.registrationNo ? 'Reg: ' + b.registrationNo : ''
  ].filter(Boolean);
  var right = lines.map(function (l) {
    return W.para(W.run(l, { size: 8.5, color: MUTED }), { align: 'right', after: 10 });
  }).join('');
  return W.table([USABLE * 0.55, USABLE * 0.45], [
    W.row([
      W.cell(left, { width: USABLE * 0.55, noBorder: true, vAlign: 'top', padH: 0 }),
      W.cell(right, { width: USABLE * 0.45, noBorder: true, vAlign: 'top', padH: 0 })
    ])
  ], { noBorder: true });
}

function titleBlock(m) {
  return W.para(W.run(m.title, { size: 22, bold: true, color: INK, spacing: 60 }),
                { align: 'center', before: 140, after: 60, border: true, borderSize: 8, borderColor: ACCENT });
}

function partyBlock(m) {
  var L = [W.para(W.run(m.party.label || 'BILL TO', { size: 8, bold: true, color: ACCENT, caps: true, spacing: 30 }), { after: 40 })];
  L.push(W.para(W.run(m.party.shop || '—', { size: 12.5, bold: true, color: INK }), { after: 20 }));
  [['Owner', m.party.owner],
   [(m.party && m.party.label === 'SUPPLIER') ? 'Supplier code' : 'Customer code', m.party.code],
   ['Mobile', m.party.contact],
   ['WhatsApp', m.party.whatsapp], ['Address', m.party.address], ['Region', m.party.region],
   ['Market / route', m.party.market]]
    .filter(function (r) { return r[1]; })
    .forEach(function (r) {
      L.push(W.para(W.run(r[0] + ': ', { size: 8.5, color: MUTED }) +
                    W.run(r[1], { size: 9, color: INK }), { after: 16 }));
    });

  var R = [W.para(W.run(m.metaLabel || 'INVOICE DETAILS', { size: 8, bold: true, color: ACCENT, caps: true, spacing: 30 }), { after: 40 })];
  var metaW = [USABLE * 0.19, USABLE * 0.21];
  var metaRows = m.meta.filter(function (r) { return r[1]; }).map(function (r) {
    return W.row([
      W.cell(W.para(W.run(r[0], { size: 8.5, color: MUTED }), { after: 0 }), { width: metaW[0], noBorder: true, padH: 0, padV: 18 }),
      W.cell(W.para(W.run(r[1], { size: 9, bold: !!r[2], color: INK }), { align: 'right', after: 0 }), { width: metaW[1], noBorder: true, padH: 0, padV: 18 })
    ]);
  });
  R.push(W.table(metaW, metaRows, { noBorder: true }));

  return W.table([USABLE * 0.55, USABLE * 0.45], [
    W.row([
      W.cell(L.join(''), { width: USABLE * 0.55, vAlign: 'top', sides: '', noBorder: true, padH: 0 }),
      W.cell(R.join(''), { width: USABLE * 0.45, vAlign: 'top', noBorder: true, padH: 0 })
    ])
  ], { noBorder: true });
}

function itemsTable(m) {
  var cols = m.columns;
  var widths = cols.map(function (c) { return Math.round(USABLE * c.width); });
  var diff = USABLE - widths.reduce(function (a, b) { return a + b; }, 0);
  widths[1] += diff;                                   // description absorbs rounding
  var rows = [];
  rows.push(W.row(cols.map(function (c, i) {
    return W.cell(W.para(W.run(c.label, { size: 8, bold: true, color: INK, caps: true, spacing: 20 }),
                         { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', after: 0 }),
                  { width: widths[i], fill: HEAD_FILL, padV: 60 });
  }), { header: true, cantSplit: true }));

  m.rows.forEach(function (r, ix) {
    rows.push(W.row(cols.map(function (c, i) {
      var val = r[c.key];
      var content;
      if (c.key === 'description') {
        content = W.para(W.run(r.descriptionUr || r.description || '', { size: 10 }), { after: 8 }) +
                  (r.description && r.descriptionUr
                    ? W.para(W.run(r.description, { size: 8, color: MUTED, rtl: false }), { after: 0 })
                    : '');
      } else {
        content = W.para(W.run(val === undefined || val === null || val === '' ? '—' : val,
          { size: 9, bold: !!c.bold }), { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', after: 0 });
      }
      return W.cell(content, { width: widths[i], padV: 46, fill: ix % 2 ? 'FAFAFC' : '' , vAlign: 'center' });
    }), { cantSplit: true }));
  });

  if (m.itemsFooter) {
    rows.push(W.row(cols.map(function (c, i) {
      var val = m.itemsFooter[c.key];
      return W.cell(W.para(W.run(val === undefined ? '' : val, { size: 9, bold: true }),
        { align: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left', after: 0 }),
        { width: widths[i], fill: 'F1EEFB', padV: 50 });
    }), { cantSplit: true }));
  }
  return W.table(widths, rows);
}

function totalsBlock(m) {
  var leftW = Math.round(USABLE * 0.52), rightW = USABLE - leftW;
  var lw = Math.round(rightW * 0.55), rw = rightW - lw;

  var totalRows = m.totals.map(function (t) {
    return W.row([
      W.cell(W.para(W.run(t.label, { size: t.big ? 10 : 9, bold: !!t.bold, color: t.bold ? INK : MUTED }) +
                    (t.labelUr ? W.run('   ' + t.labelUr, { size: t.big ? 10 : 9, color: MUTED, rtl: true }) : ''),
                    { after: 0 }),
             { width: lw, sides: t.rule ? 't' : '', borderColor: LINE, padV: t.big ? 60 : 34,
               fill: t.big ? 'F1EEFB' : '' }),
      W.cell(W.para(W.run(t.value, { size: t.big ? 12 : 9.5, bold: t.bold || t.big, color: INK }),
                    { align: 'right', after: 0 }),
             { width: rw, sides: t.rule ? 't' : '', borderColor: LINE, padV: t.big ? 60 : 34,
               fill: t.big ? 'F1EEFB' : '' })
    ], { cantSplit: true });
  });

  var leftCol = [];
  if (m.words) {
    leftCol.push(W.para(W.run('AMOUNT IN WORDS', { size: 7.5, bold: true, color: ACCENT, caps: true, spacing: 20 }), { after: 20 }));
    leftCol.push(W.para(W.run(m.words, { size: 9, italic: true, color: INK }), { after: 90 }));
  }
  if (m.paymentsList && m.paymentsList.length) {
    leftCol.push(W.para(W.run('PAYMENTS AGAINST THIS INVOICE', { size: 7.5, bold: true, color: ACCENT, caps: true, spacing: 20 }), { after: 20 }));
    m.paymentsList.forEach(function (p) {
      leftCol.push(W.para(W.run(p.date + ' · ' + p.method + (p.ref ? ' · ' + p.ref : '') + ' — ', { size: 8.5, color: MUTED }) +
                          W.run(p.amount, { size: 8.5, bold: true }), { after: 16 }));
    });
    leftCol.push(W.empty(60));
  }
  if (m.notes) {
    leftCol.push(W.para(W.run('NOTES', { size: 7.5, bold: true, color: ACCENT, caps: true, spacing: 20 }), { after: 20 }));
    leftCol.push(W.para(W.run(m.notes, { size: 8.5, color: INK }), { after: 0 }));
  }

  return W.table([leftW, rightW], [
    W.row([
      W.cell(leftCol.join('') || W.empty(0), { width: leftW, noBorder: true, vAlign: 'top', padH: 0 }),
      W.cell(W.table([lw, rw], totalRows, { noBorder: true }), { width: rightW, noBorder: true, vAlign: 'top', padH: 0 })
    ], { cantSplit: true })
  ], { noBorder: true });
}

function ledgerBlock(m) {
  if (!m.ledger || !m.ledger.length) return '';
  var w = Math.round(USABLE / 2);
  var rows = m.ledger.map(function (r, i) {
    return W.row([
      W.cell(W.para(W.run(r[0], { size: 9, color: MUTED }) +
                    (r[2] ? W.run('   ' + r[2], { size: 9, color: MUTED, rtl: true }) : ''), { after: 0 }),
             { width: w, padV: 40, fill: i === m.ledger.length - 1 ? 'F6F3FE' : '' }),
      W.cell(W.para(W.run(r[1], { size: 9.5, bold: i === m.ledger.length - 1 }), { align: 'right', after: 0 }),
             { width: USABLE - w, padV: 40, fill: i === m.ledger.length - 1 ? 'F6F3FE' : '' })
    ], { cantSplit: true });
  });
  return W.para(W.run('CUSTOMER ACCOUNT', { size: 7.5, bold: true, color: ACCENT, caps: true, spacing: 20 }),
                { before: 160, after: 30, keepNext: true }) +
         W.table([w, USABLE - w], rows);
}

function signatureBlock(labels) {
  var w = Math.round(USABLE / labels.length);
  return W.para('', { before: 320, after: 0 }) +
    W.table(labels.map(function () { return w; }), [
      W.row(labels.map(function (l) {
        return W.cell(W.para(W.run(' ', { size: 9 }), { after: 30, border: true, borderColor: '8C8C99', borderSize: 4 }) +
                      W.para(W.run(l, { size: 8, color: MUTED, caps: true, spacing: 20 }), { align: 'left', after: 0 }),
                      { width: w, noBorder: true, padH: 60, vAlign: 'bottom' });
      }))
    ], { noBorder: true });
}

function footerBlock(m) {
  var out = [W.para('', { before: 200, after: 60, border: true, borderColor: LINE })];
  if (m.footer.thanks) out.push(W.para(W.run(m.footer.thanks, { size: 10, bold: true, color: INK }), { align: 'center', after: 20 }));
  out.push(W.para(W.run(m.business.name + ' · ' + m.business.tagline, { size: 8.5, color: MUTED }), { align: 'center', after: 40 }));
  if (m.footer.terms) out.push(W.para(W.run(m.footer.terms, { size: 8, color: MUTED }), { align: 'center', after: 20 }));
  if (m.footer.bank) out.push(W.para(W.run(m.footer.bank, { size: 8, color: MUTED }), { align: 'center', after: 0 }));
  return out.join('');
}

var DOCX = {
  zip: zip, W: W, USABLE: USABLE,

  /* Build the Word body from a document model (§51). */
  fromModel: function (m) {
    var body = [];
    body.push(headerBlock(m));
    body.push(titleBlock(m));
    body.push(W.empty(60));
    body.push(partyBlock(m));
    body.push(W.empty(120));
    if (m.strip && m.strip.length) {
      var sw = Math.round(USABLE / m.strip.length);
      body.push(W.table(m.strip.map(function () { return sw; }), [
        W.row(m.strip.map(function (s) {
          return W.cell(W.para(W.run(s[0], { size: 7.5, color: MUTED, caps: true, spacing: 20 }), { after: 12 }) +
                        W.para(W.run(s[1], { size: 9.5, bold: true }), { after: 0 }),
                        { width: sw, fill: 'F7F6FB', padV: 50 });
        }))
      ]));
      body.push(W.empty(120));
    }
    if (m.rows && m.rows.length) { body.push(itemsTable(m)); body.push(W.empty(140)); }
    if (m.totals && m.totals.length) body.push(totalsBlock(m));
    body.push(ledgerBlock(m));
    if (m.signatures && m.signatures.length) body.push(signatureBlock(m.signatures));
    body.push(footerBlock(m));
    return body.join('');
  },

  generate: function (m) {
    return pack(DOCX.fromModel(m), {
      title: m.title + ' ' + (m.number || ''),
      author: m.business.name,
      footerText: m.business.name + ' · ' + (m.number || '') + ' · ' + (m.date || '')
    });
  },

  filename: function (m) {
    var party = (m.party && (m.party.shop || m.party.owner) || '').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
    var base = (m.business.name || 'Farooq-Co').replace(/[^\w]+/g, '-');
    return [base, m.title.replace(/[^\w]+/g, '-'), m.number || 'draft', party].filter(Boolean).join('-') + '.docx';
  },

  download: function (m) {
    var bytes = DOCX.generate(m);
    var blob = new global.Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    var url = global.URL.createObjectURL(blob);
    var a = global.document.createElement('a');
    a.href = url; a.download = DOCX.filename(m);
    global.document.body.appendChild(a); a.click();
    setTimeout(function () { global.URL.revokeObjectURL(url); a.remove(); }, 1500);
    return DOCX.filename(m);
  }
};

global.DOCX = DOCX;
if (typeof module !== 'undefined' && module.exports) module.exports = DOCX;
})(typeof window !== 'undefined' ? window : globalThis);
