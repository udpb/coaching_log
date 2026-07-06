// ============================================================
// public/report-template-parser.js — 리포트 템플릿 스켈레톤 빌더 (B2)
// ------------------------------------------------------------
// 발주처 양식(.docx / .xlsx)을 zip 해제해 "블록 리스트(스켈레톤)" 로 뽑는
// 순수 JS 파서. 이 스켈레톤 JSON 이 다음 단계(AI ingest)의 입력이 된다.
//
//   - 브라우저: <script src="/report-template-parser.js"> → window.UD_REPORT_PARSER
//               (이미 로드된 CDN 전역 window.PizZip · XLSX · DOMParser 재사용)
//   - 서버리스/Node 테스트: require('../public/report-template-parser.js')
//               (deps 를 opts 로 주입: { PizZip, XLSX, DOMParser })
//
// 설계 원칙:
//   - 순수 함수(부수효과 없음) — AI · 네트워크 · DB 와 무관. unzip + 구조 추출만.
//   - text 는 raw 로 반환. DOM 삽입은 이 모듈이 하지 않으므로 escHtml/escAttr
//     불필요하나, 반환 text 를 UI 가 innerHTML 에 넣을 땐 호출부가 escape 해야 함.
//   - text 가 비었거나 공백뿐이면 empty:true — "채울 후보 칸" 판단의 기초.
//   - block_id 는 렌더 단계에서 다시 찾을 수 있는 안정적 식별자
//     (docx: 문단 순번 'p12' · 표셀 좌표 't3r0c1' / xlsx: A1 주소 'D8').
//   - 라이브러리 중복 로드 금지 — index.html 이 이미 로드한 전역을 그대로 씀.
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.UD_REPORT_PARSER = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 스켈레톤 스키마 버전 — ingest 프롬프트/렌더가 이 형태에 의존하므로,
  // 블록 shape 를 바꾸면 올린다.
  var SKELETON_VERSION = 1;

  // ---- 의존성 해석 (브라우저 전역 우선, 없으면 opts 주입) -----------------
  function _resolvePizZip(opts) {
    if (opts && opts.PizZip) return opts.PizZip;
    if (typeof PizZip !== 'undefined') return PizZip;                 // 번들 전역
    if (typeof window !== 'undefined' && window.PizZip) return window.PizZip;
    throw new Error('report-template-parser: PizZip 를 찾을 수 없습니다 (opts.PizZip 로 주입하세요).');
  }
  function _resolveXLSX(opts) {
    if (opts && opts.XLSX) return opts.XLSX;
    if (typeof XLSX !== 'undefined') return XLSX;                     // 번들 전역
    if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
    throw new Error('report-template-parser: XLSX 를 찾을 수 없습니다 (opts.XLSX 로 주입하세요).');
  }
  function _resolveDOMParser(opts) {
    if (opts && opts.DOMParser) return opts.DOMParser;
    if (typeof DOMParser !== 'undefined') return DOMParser;          // 브라우저 내장
    if (typeof window !== 'undefined' && window.DOMParser) return window.DOMParser;
    throw new Error('report-template-parser: DOMParser 를 찾을 수 없습니다 (Node 테스트 시 opts.DOMParser 로 @xmldom/xmldom 주입).');
  }

  // ---- 공통 소도구 -------------------------------------------------------
  function _isBlank(s) {
    // 공백류(스페이스/탭/개행/전각공백 U+3000/제로폭)만 있으면 blank.
    return !s || String(s).replace(/[\s　​﻿]/g, '') === '';
  }
  function _name(el) { return el.nodeName || el.tagName || ''; }
  function _childElements(node) {
    var out = [];
    if (!node || !node.childNodes) return out;
    var ch = node.childNodes;
    for (var i = 0; i < ch.length; i++) { if (ch[i].nodeType === 1) out.push(ch[i]); }
    return out;
  }
  function _byTag(el, tag) {
    // getElementsByTagName 은 XML DOMParser 에서 접두사 포함('w:t') 이름을 유지한다.
    if (el && el.getElementsByTagName) return el.getElementsByTagName(tag);
    return [];
  }
  function _nodeText(el) {
    if (el == null) return '';
    if (el.textContent != null) return el.textContent;
    // textContent 미지원 DOM 대비 fallback: 자식 텍스트 노드 수집.
    var s = '', ch = el.childNodes;
    if (!ch) return '';
    for (var i = 0; i < ch.length; i++) {
      if (ch[i].nodeType === 3) s += (ch[i].nodeValue || '');
      else if (ch[i].nodeType === 1) s += _nodeText(ch[i]);
    }
    return s;
  }

  // ========================================================================
  // DOCX — word/document.xml 을 문단(w:p) · 표셀(w:tc) 블록 리스트로.
  //   반환: { format:'docx', version, blocks:[ {block_id, kind, text, empty, path} ], stats }
  // ========================================================================
  function buildDocxSkeleton(arrayBuffer, opts) {
    var PizZipCtor = _resolvePizZip(opts);
    var DOMParserCtor = _resolveDOMParser(opts);

    var zip = new PizZipCtor(arrayBuffer);
    var entry = zip.file('word/document.xml');
    if (!entry) throw new Error('report-template-parser: word/document.xml 없음 — .docx 가 아닌 듯합니다.');
    var xml = entry.asText();

    var parser = new DOMParserCtor();
    var doc = parser.parseFromString(xml, 'application/xml');

    var body = _byTag(doc, 'w:body')[0]
      || (doc.documentElement ? _byTag(doc.documentElement, 'w:body')[0] : null)
      || doc.documentElement;

    var blocks = [];
    var pCount = 0, tblCount = 0, cellCount = 0;

    // 문단 텍스트 = 내부 w:t 런(run) 을 순서대로 합침. w:tab/w:br 은 공백/개행 힌트.
    function paraText(pEl) {
      var out = '';
      var ch = pEl.childNodes;
      (function walk(node) {
        var kids = node.childNodes; if (!kids) return;
        for (var i = 0; i < kids.length; i++) {
          var k = kids[i];
          if (k.nodeType !== 1) continue;
          var nm = _name(k);
          if (nm === 'w:t') { out += _nodeText(k); }
          else if (nm === 'w:tab') { out += '\t'; }
          else if (nm === 'w:br' || nm === 'w:cr') { out += '\n'; }
          else { walk(k); }
        }
      })({ childNodes: ch });
      return out;
    }
    // 셀 텍스트 = 셀 내부 모든 w:t 를 문단 경계(개행)로 합침.
    function cellText(tcEl) {
      var paras = [];
      var direct = _childElements(tcEl);
      for (var i = 0; i < direct.length; i++) {
        if (_name(direct[i]) === 'w:p') paras.push(paraText(direct[i]));
      }
      // 중첩 표 등으로 직속 문단이 없으면 전체 w:t fallback.
      if (paras.length === 0) {
        var ts = _byTag(tcEl, 'w:t'), s = '';
        for (var j = 0; j < ts.length; j++) s += _nodeText(ts[j]);
        return s;
      }
      return paras.join('\n');
    }

    // body 직속 자식을 문서 순서대로 순회: w:p → 문단 블록, w:tbl → 표셀 블록들.
    function walkContainer(container, tablePathPrefix) {
      var kids = _childElements(container);
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i], nm = _name(el);
        if (nm === 'w:p') {
          var t = paraText(el);
          blocks.push({
            block_id: 'p' + pCount,
            kind: 'paragraph',
            text: t,
            empty: _isBlank(t),
            path: { para: pCount }
          });
          pCount++;
        } else if (nm === 'w:tbl') {
          var thisTbl = tblCount++;
          var rows = _childElements(el).filter(function (r) { return _name(r) === 'w:tr'; });
          for (var ri = 0; ri < rows.length; ri++) {
            var cells = _childElements(rows[ri]).filter(function (c) { return _name(c) === 'w:tc'; });
            for (var ci = 0; ci < cells.length; ci++) {
              var ct = cellText(cells[ci]);
              blocks.push({
                block_id: 't' + thisTbl + 'r' + ri + 'c' + ci,
                kind: 'tablecell',
                text: ct,
                empty: _isBlank(ct),
                path: { table: thisTbl, row: ri, cell: ci }
              });
              cellCount++;
            }
          }
        }
        // 그 외(w:sectPr 등)는 스킵.
      }
    }
    walkContainer(body);

    return {
      format: 'docx',
      version: SKELETON_VERSION,
      blocks: blocks,
      stats: {
        blocks: blocks.length,
        paragraphs: pCount,
        tables: tblCount,
        table_cells: cellCount,
        empty_blocks: blocks.filter(function (b) { return b.empty; }).length
      }
    };
  }

  // ========================================================================
  // XLSX — 각 시트의 사용 범위 셀을 A1 주소 블록으로. 병합셀(!merges) 포함.
  //   반환: { format:'xlsx', version, sheets:[ {name, cells:[{cell,r,c,text,empty,merge?}], merges:[...], stats} ], stats }
  // ========================================================================
  function buildXlsxSkeleton(arrayBuffer, opts) {
    var XLSXlib = _resolveXLSX(opts);
    // 안전 상한 — 거대한 시트에서 셀 폭발 방지. 초과분은 truncated 플래그.
    var MAX_ROWS = (opts && opts.maxRows) || 500;
    var MAX_COLS = (opts && opts.maxCols) || 200;

    // xlsx 는 type:'array' 에 Uint8Array(8-bit) 를 기대. ArrayBuffer → Uint8Array.
    var data = (arrayBuffer instanceof Uint8Array) ? arrayBuffer : new Uint8Array(arrayBuffer);
    var wb = XLSXlib.read(data, { type: 'array', cellStyles: true, cellDates: true });
    var U = XLSXlib.utils;

    var sheets = [];
    var grandCells = 0, grandEmpty = 0, grandMerges = 0;

    (wb.SheetNames || []).forEach(function (name) {
      var ws = wb.Sheets[name];
      if (!ws) return;

      // 병합 정보: {s:{r,c},e:{r,c}} → A1 범위 문자열 + 앵커(좌상단) 인덱스 맵.
      var merges = [];
      var anchorMerge = {};   // "r,c"(앵커) → "D8:F8"
      var coveredBy = {};     // "r,c"(피복 셀) → 앵커 "D8"
      (ws['!merges'] || []).forEach(function (m) {
        var range = U.encode_range(m);        // 예: 'D8:F8'
        var anchorAddr = U.encode_cell(m.s);  // 예: 'D8'
        merges.push(range);
        anchorMerge[m.s.r + ',' + m.s.c] = range;
        for (var rr = m.s.r; rr <= m.e.r; rr++) {
          for (var cc = m.s.c; cc <= m.e.c; cc++) {
            if (rr === m.s.r && cc === m.s.c) continue;
            coveredBy[rr + ',' + cc] = anchorAddr;
          }
        }
      });

      var cells = [];
      var filled = 0, empties = 0, truncated = false;

      var ref = ws['!ref'];
      if (ref) {
        var rng = U.decode_range(ref);
        var r0 = rng.s.r, c0 = rng.s.c;
        var r1 = rng.e.r, c1 = rng.e.c;

        // !ref 는 서식만 있는 빈 행/열까지 과대보고하는 일이 잦다(빈 셀 폭발).
        // 실제 값이 든 마지막 행/열을 찾아 + 패딩으로 범위를 조인다 —
        // 데이터에 인접한 "채울 후보" 빈칸은 남기고 먼 빈 영역만 버린다.
        var pad = (opts && opts.pad != null) ? opts.pad : 2;
        var maxFR = -1, maxFC = -1;
        for (var sr = r0; sr <= r1; sr++) {
          for (var sc = c0; sc <= c1; sc++) {
            var scAddr = U.encode_cell({ r: sr, c: sc });
            var sco = ws[scAddr];
            if (sco && (sco.v != null || (sco.w != null && String(sco.w) !== ''))) {
              if (sr > maxFR) maxFR = sr;
              if (sc > maxFC) maxFC = sc;
            }
          }
        }
        // 병합 앵커도 "데이터"로 취급해 경계에 포함.
        (ws['!merges'] || []).forEach(function (m) {
          if (m.e.r > maxFR) maxFR = m.e.r;
          if (m.e.c > maxFC) maxFC = m.e.c;
        });
        if (maxFR >= r0 && maxFR + pad < r1) r1 = maxFR + pad;
        if (maxFC >= c0 && maxFC + pad < c1) c1 = maxFC + pad;

        if (r1 - r0 + 1 > MAX_ROWS) { r1 = r0 + MAX_ROWS - 1; truncated = true; }
        if (c1 - c0 + 1 > MAX_COLS) { c1 = c0 + MAX_COLS - 1; truncated = true; }

        for (var r = r0; r <= r1; r++) {
          for (var c = c0; c <= c1; c++) {
            var addr = U.encode_cell({ r: r, c: c });
            var cellObj = ws[addr];
            // 표시 텍스트: 포맷된 w 우선, 없으면 원시 v.
            var text = '';
            if (cellObj) {
              if (cellObj.w != null) text = String(cellObj.w);
              else if (cellObj.v != null) text = String(cellObj.v);
            }
            var key = r + ',' + c;
            var out = {
              cell: addr,
              r: r,
              c: c,
              text: text,
              empty: _isBlank(text)
            };
            if (anchorMerge[key]) out.merge = anchorMerge[key];       // 이 셀이 병합 앵커
            if (coveredBy[key]) out.covered_by = coveredBy[key];       // 병합에 덮인 셀
            cells.push(out);
            if (out.empty) empties++; else filled++;
          }
        }
      }

      grandCells += cells.length;
      grandEmpty += empties;
      grandMerges += merges.length;

      sheets.push({
        name: name,
        cells: cells,
        merges: merges,
        stats: {
          cells: cells.length,
          filled: filled,
          empty: empties,
          merges: merges.length,
          truncated: truncated
        }
      });
    });

    return {
      format: 'xlsx',
      version: SKELETON_VERSION,
      sheets: sheets,
      stats: {
        sheet_count: sheets.length,
        cells: grandCells,
        empty_cells: grandEmpty,
        merges: grandMerges
      }
    };
  }

  // ========================================================================
  // 공통 진입 디스패처. format 미지정 시 예외 (호출부가 파일 확장자로 판단).
  // ========================================================================
  function buildSkeleton(arrayBuffer, format, opts) {
    var fmt = String(format || '').toLowerCase();
    if (fmt === 'docx' || fmt === 'doc') return buildDocxSkeleton(arrayBuffer, opts);
    if (fmt === 'xlsx' || fmt === 'xls') return buildXlsxSkeleton(arrayBuffer, opts);
    throw new Error('report-template-parser: 지원하지 않는 format "' + format + '" (docx|xlsx).');
  }

  return {
    SKELETON_VERSION: SKELETON_VERSION,
    buildSkeleton: buildSkeleton,
    buildDocxSkeleton: buildDocxSkeleton,
    buildXlsxSkeleton: buildXlsxSkeleton,
    // 테스트/재사용용 소도구 노출 (내부 구현 — 안정 계약 아님).
    _util: { isBlank: _isBlank }
  };
});
