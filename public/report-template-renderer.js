// ============================================================
// public/report-template-renderer.js — 리포트 템플릿 결정론적 렌더러 (B5+B6)
// ------------------------------------------------------------
// AI(B4 fill)가 슬롯에 배정한 value 를, 발주처 원본 템플릿의 서식을 보존한 채
// 주입해 최종 파일(Blob)을 만드는 순수 렌더러. AI 는 관여하지 않는다(값은 결정됨).
//
//   - 브라우저: <script src="/report-template-renderer.js"> → window.UD_REPORT_RENDERER
//               (index.html 이 이미 로드한 CDN 전역 window.PizZip · XLSX · DOMParser ·
//                XMLSerializer · Blob 재사용 — 중복 로드 금지. index.html:11-15)
//   - Node 테스트: require('../public/report-template-renderer.js')
//               (deps 를 opts 로 주입: { PizZip, XLSX, DOMParser, XMLSerializer })
//
// 입력 계약:
//   · templateArrayBuffer — report_templates.file_base64 를 디코드한 원본 바이트
//     (docx/xlsx). ⚠️ docx 는 원본(file_base64)만으로 자기완결 렌더 — templatized_base64
//     (토큰 baked docx) 를 요구하지 않는다. (아래 [DOCX 전략] 참조)
//   · slotSchema — api/template-ai.js normalizeSlotSchema 출력 shape:
//       { template_kind, slots:[{id,label,anchor,level,repeat_group,field_guess,confidence}],
//         repeat_groups:[{id, docx_block_range?, xlsx_column_pattern?, max_slots?}] }
//     앵커 규약(B2 report-template-parser 와 동일):
//       docx anchor = { block_id:'p12' | 't3r0c1' }   (문단 pN · 표셀 tXrYcZ)
//       xlsx anchor = { sheet:'...', cell:'D8' }
//   · filledData — B4 fill 출력:
//       { report:{ slotId:{value,evidence,confidence} },
//         sessions:[ { slotId:{value,...} }, ... ] }
//     렌더러는 evidence/confidence 를 무시하고 value 만 사용(검토는 UI 단계 C 에서 끝남).
//
// ── [DOCX 전략] (A) 앵커 기반 직접 치환 — 채택 ────────────────────────────
//   B3 ingest 가 아직 "태그 baking"(templatized_base64 생성)을 구현하지 않아,
//   docxtemplater 로 {{slot}} 토큰을 채우는 (B) 안은 전제(baked docx)가 없다.
//   따라서 MVP 는 (A): 원본 docx 의 word/document.xml 을 DOM 으로 파싱해,
//   슬롯 앵커(block_id)로 대상 문단/표셀을 찾아 그 텍스트를 value 로 직접 치환한다.
//   - 자기완결: ingest 산출물(원본 바이트)만 있으면 렌더된다. docxtemplater 불필요.
//   - 서식 보존: 대상 블록의 첫 run(w:r) 서식(rPr)을 유지하고 텍스트만 교체.
//   - 세션 반복: repeat_group.docx_block_range 로 지정된 "한 세션 블록"(표 행 또는
//     body 문단 그룹)을 세션 수만큼 cloneNode 복제 후, 각 복제본의 세션 슬롯 앵커에
//     상대경로(childNodes path)로 값을 주입한다.
//   - 값은 createTextNode/w:br 로 넣으므로 XML 특수문자·줄바꿈이 자동/명시적으로
//     이스케이프된다(& < > 및 \n → <w:br/>).
//   한계는 파일 하단 [한계/TODO] 참조.
//
// ── [XLSX 전략] 좌표 주입 (서식/병합 보존) ────────────────────────────────
//   원본 워크북을 xlsx-js-style 로 로드(cellStyles:true) → 슬롯 앵커 셀의 .v 만 교체.
//   aoa_to_sheet 금지(스타일·병합 소실). ws['!merges']·'!cols'·각 셀 .s 는 그대로 둔다.
//   전치 매트릭스: repeat_group.xlsx_column_pattern.session_cols 로 회차→열그룹 매핑
//   (세션 슬롯의 원본 anchor.cell 이 속한 열그룹/오프셋을 찾아 회차 i 의 열그룹으로 shift).
//   세션 수 > 열그룹 수면 초과분을 자르고 경고를 반환 정보에 담는다(확정 결정).
// ============================================================
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else { root.UD_REPORT_RENDERER = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var RENDERER_VERSION = 1;

  // WordprocessingML 네임스페이스 — 새 run/w:t/w:br 생성 시 prefix 'w' 유지용.
  var WNS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  // ---- 의존성 해석 (브라우저 전역 우선, 없으면 opts 주입) ------------------
  function _resolvePizZip(opts) {
    if (opts && opts.PizZip) return opts.PizZip;
    if (typeof PizZip !== 'undefined') return PizZip;
    if (typeof window !== 'undefined' && window.PizZip) return window.PizZip;
    throw new Error('report-template-renderer: PizZip 를 찾을 수 없습니다 (opts.PizZip 로 주입하세요).');
  }
  function _resolveXLSX(opts) {
    if (opts && opts.XLSX) return opts.XLSX;
    if (typeof XLSX !== 'undefined') return XLSX;
    if (typeof window !== 'undefined' && window.XLSX) return window.XLSX;
    throw new Error('report-template-renderer: XLSX 를 찾을 수 없습니다 (opts.XLSX 로 주입하세요).');
  }
  function _resolveDOMParser(opts) {
    if (opts && opts.DOMParser) return opts.DOMParser;
    if (typeof DOMParser !== 'undefined') return DOMParser;
    if (typeof window !== 'undefined' && window.DOMParser) return window.DOMParser;
    throw new Error('report-template-renderer: DOMParser 를 찾을 수 없습니다 (Node 테스트 시 opts.DOMParser 로 @xmldom/xmldom 주입).');
  }
  function _resolveXMLSerializer(opts) {
    if (opts && opts.XMLSerializer) return opts.XMLSerializer;
    if (typeof XMLSerializer !== 'undefined') return XMLSerializer;
    if (typeof window !== 'undefined' && window.XMLSerializer) return window.XMLSerializer;
    throw new Error('report-template-renderer: XMLSerializer 를 찾을 수 없습니다 (Node 테스트 시 opts.XMLSerializer 로 @xmldom/xmldom 주입).');
  }

  // ---- 공통 소도구 -------------------------------------------------------
  function _name(el) { return (el && (el.nodeName || el.tagName)) || ''; }
  function _childElements(node) {
    var out = [];
    if (!node || !node.childNodes) return out;
    var ch = node.childNodes;
    for (var i = 0; i < ch.length; i++) { if (ch[i].nodeType === 1) out.push(ch[i]); }
    return out;
  }
  function _firstChildTag(el, tag) {
    var kids = _childElements(el);
    for (var i = 0; i < kids.length; i++) { if (_name(kids[i]) === tag) return kids[i]; }
    return null;
  }
  function _slotValue(bag, id) {
    if (!bag || !id) return '';
    var e = bag[id];
    if (e && e.value != null) return String(e.value);
    return '';
  }
  function _normSchema(s) {
    s = (s && typeof s === 'object') ? s : {};
    return {
      template_kind: s.template_kind || 'single',
      slots: Array.isArray(s.slots) ? s.slots : [],
      repeat_groups: Array.isArray(s.repeat_groups) ? s.repeat_groups : []
    };
  }
  function _anchorRef(slot) {
    var a = (slot && slot.anchor) || {};
    return a.block_id || a.ref || null;   // docx
  }
  function _anchorCell(slot) {
    var a = (slot && slot.anchor) || {};
    return { sheet: a.sheet || null, cell: a.cell || a.ref || null };  // xlsx
  }

  // 파일명 새니타이즈 (index.html:8800-8801 규칙 자체 포함 — 전역 오염 없이).
  function sanitizeFilename(s, maxLen) {
    var lim = maxLen || 80;
    return String(s == null ? '' : s)
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, lim);
  }
  // 한국어 날짜 (index.html:8704-8709 _fmtKDate 자체 포함).
  function fmtKDate(iso) {
    if (!iso) return '____';
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return iso;
    return m[1] + '년 ' + parseInt(m[2], 10) + '월 ' + parseInt(m[3], 10) + '일';
  }

  // ========================================================================
  // DOCX 텍스트 치환 소도구 (서식 보존)
  // ========================================================================
  // w:t 노드의 텍스트를 교체(자식 비우고 텍스트 노드 재삽입). 공백 보존 속성 부여.
  function _setTNode(t, text) {
    while (t.firstChild) t.removeChild(t.firstChild);
    t.setAttribute('xml:space', 'preserve');
    t.appendChild(t.ownerDocument.createTextNode(text == null ? '' : String(text)));
  }
  // el(w:p 또는 w:tc) 안의 모든 w:t 를 순서대로 수집.
  function _collectT(el) {
    var out = [], list = el.getElementsByTagName ? el.getElementsByTagName('w:t') : [];
    for (var i = 0; i < list.length; i++) out.push(list[i]);
    return out;
  }
  // 첫 w:t 에 value(줄바꿈 포함) 주입 — 같은 run 안에서 \n → w:br 로 전개.
  function _setFirstRunText(firstT, value) {
    var doc = firstT.ownerDocument;
    var run = firstT.parentNode;  // w:r
    var segs = String(value == null ? '' : value).split('\n');
    _setTNode(firstT, segs[0]);
    if (segs.length === 1 || !run) return;
    var ref = firstT.nextSibling;
    for (var i = 1; i < segs.length; i++) {
      run.insertBefore(doc.createElementNS(WNS, 'w:br'), ref);
      var t = doc.createElementNS(WNS, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.appendChild(doc.createTextNode(segs[i]));
      run.insertBefore(t, ref);
    }
  }
  // run 이 하나도 없는 빈 문단/셀에 새 run 을 만들어 value 주입.
  function _appendNewRun(el, value) {
    var doc = el.ownerDocument;
    var p = (_name(el) === 'w:tc') ? _firstChildTag(el, 'w:p') : el;
    if (!p) { p = doc.createElementNS(WNS, 'w:p'); el.appendChild(p); }
    var r = doc.createElementNS(WNS, 'w:r');
    var segs = String(value == null ? '' : value).split('\n');
    var t0 = doc.createElementNS(WNS, 'w:t');
    t0.setAttribute('xml:space', 'preserve');
    t0.appendChild(doc.createTextNode(segs[0]));
    r.appendChild(t0);
    for (var i = 1; i < segs.length; i++) {
      r.appendChild(doc.createElementNS(WNS, 'w:br'));
      var t = doc.createElementNS(WNS, 'w:t');
      t.setAttribute('xml:space', 'preserve');
      t.appendChild(doc.createTextNode(segs[i]));
      r.appendChild(t);
    }
    p.appendChild(r);
  }
  // 대상 블록(w:p|w:tc)의 표시 텍스트를 value 로 교체(첫 run 서식 유지·나머지 비움).
  function _docxSetText(el, value) {
    if (!el) return;
    var ts = _collectT(el);
    if (ts.length === 0) { _appendNewRun(el, value); return; }
    for (var i = 1; i < ts.length; i++) _setTNode(ts[i], '');
    _setFirstRunText(ts[0], value);
  }

  // ========================================================================
  // DOCX block_id → DOM 요소 맵 (B2 파서와 동일한 순번 규약)
  //   pN      = body 직속 N번째 w:p
  //   tXrYcZ  = X번째 w:tbl 의 Y번째 w:tr 의 Z번째 w:tc
  // ========================================================================
  function _buildDocxBlockMap(body) {
    var map = {};
    var pCount = 0, tblCount = 0;
    var kids = _childElements(body);
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i], nm = _name(el);
      if (nm === 'w:p') {
        map['p' + pCount] = { el: el };
        pCount++;
      } else if (nm === 'w:tbl') {
        var t = tblCount++;
        var rows = _childElements(el).filter(function (r) { return _name(r) === 'w:tr'; });
        for (var ri = 0; ri < rows.length; ri++) {
          var cells = _childElements(rows[ri]).filter(function (c) { return _name(c) === 'w:tc'; });
          for (var ci = 0; ci < cells.length; ci++) {
            map['t' + t + 'r' + ri + 'c' + ci] = {
              el: cells[ci], tblEl: el, rowEl: rows[ri], table: t, row: ri, cell: ci
            };
          }
        }
      }
    }
    return map;
  }

  // ancestor→descendant childNodes 인덱스 경로 (cloneNode 후 동일 위치 재탐색용).
  function _pathTo(ancestor, el) {
    var path = [], cur = el;
    while (cur && cur !== ancestor) {
      var parent = cur.parentNode;
      if (!parent) return null;
      var idx = -1, ch = parent.childNodes;
      for (var i = 0; i < ch.length; i++) { if (ch[i] === cur) { idx = i; break; } }
      if (idx < 0) return null;
      path.unshift(idx);
      cur = parent;
    }
    return (cur === ancestor) ? path : null;
  }
  function _nodeAtPath(root, path) {
    var cur = root;
    for (var i = 0; i < path.length; i++) {
      if (!cur || !cur.childNodes) return null;
      cur = cur.childNodes[path[i]];
    }
    return cur;
  }
  // body 직속 조상(el 을 포함하는 body 의 직계 자식) 찾기.
  function _bodyLevelAncestor(body, el) {
    var cur = el;
    while (cur && cur.parentNode && cur.parentNode !== body) cur = cur.parentNode;
    return (cur && cur.parentNode === body) ? cur : null;
  }

  // ---- DOCX 세션 반복 처리 (다중그룹 안전) ------------------------------
  // BUGFIX(버그1 — 다중 repeat_group 인덱스 시프트): 그룹마다 map 을 재빌드하면
  //   앞 그룹 확장으로 뒤 그룹 앵커(pN/tXrYcZ)가 밀린 위치를 가리켜 오배치(경고
  //   없음)됐다. → 변형 전 단일 map 으로 모든 그룹의 unitEls·slot 매핑을 DOM
  //   참조로 선해석(_resolveDocxRepeat, 인덱스 재탐색 금지)해 두고, 적용 시
  //   (_applyDocxRepeatResolved) insertRef 는 라이브 nextSibling 으로 계산한다.
  //   DOM 노드 참조는 형제 이동/삭제에도 유효하므로 그룹 간 간섭·순서 의존 0.

  // 변형 없이 반복단위 요소·슬롯 매핑을 DOM 참조로 해석. 실패 시 null + warn.
  function _resolveDocxRepeat(map, body, group, groupSlots, warnings) {
    var range = group.docx_block_range;
    if (!Array.isArray(range) || range.length < 1) {
      warnings.push('repeat group "' + group.id + '": docx_block_range 없음 — 반복 건너뜀');
      return null;
    }
    var firstId = range[0], lastId = range[range.length - 1];
    var fEntry = map[firstId], lEntry = map[lastId];
    if (!fEntry || !lEntry) {
      warnings.push('repeat group "' + group.id + '": 앵커 미발견 (' + firstId + ', ' + lastId + ')');
      return null;
    }

    var unitEls, parent;
    if (fEntry.rowEl && lEntry.rowEl && fEntry.tblEl === lEntry.tblEl) {
      // 표 행 반복 — 한 세션 = 한 행(또는 연속 행들)
      parent = fEntry.tblEl;
      var allRows = _childElements(parent).filter(function (r) { return _name(r) === 'w:tr'; });
      var ri0 = allRows.indexOf(fEntry.rowEl), ri1 = allRows.indexOf(lEntry.rowEl);
      if (ri0 < 0 || ri1 < 0) { warnings.push('repeat group "' + group.id + '": 행 위치 확인 실패'); return null; }
      if (ri0 > ri1) { var tmp = ri0; ri0 = ri1; ri1 = tmp; }
      unitEls = allRows.slice(ri0, ri1 + 1);
    } else {
      // body 레벨 반복 — 한 세션 = body 직속 요소들(문단/표)
      parent = body;
      var blF = _bodyLevelAncestor(body, fEntry.el), blL = _bodyLevelAncestor(body, lEntry.el);
      var bkids = _childElements(body);
      var bi0 = bkids.indexOf(blF), bi1 = bkids.indexOf(blL);
      if (bi0 < 0 || bi1 < 0) { warnings.push('repeat group "' + group.id + '": body 조상 확인 실패'); return null; }
      if (bi0 > bi1) { var tmp2 = bi0; bi0 = bi1; bi1 = tmp2; }
      unitEls = bkids.slice(bi0, bi1 + 1);
    }
    if (unitEls.length === 0) return null;

    // 세션 슬롯 → (반복단위 내부 요소 index, childNodes 경로) 매핑.
    var mappings = [];
    groupSlots.forEach(function (slot) {
      var aid = _anchorRef(slot);
      if (!aid) return;
      var target = map[aid] ? map[aid].el : null;
      if (!target) { warnings.push('session slot "' + slot.id + '": 앵커 ' + aid + ' 미발견'); return; }
      var ui = -1, path = null;
      for (var u = 0; u < unitEls.length; u++) {
        if (unitEls[u] === target) { ui = u; path = []; break; }
        var p = _pathTo(unitEls[u], target);
        if (p) { ui = u; path = p; break; }
      }
      if (ui < 0) { warnings.push('session slot "' + slot.id + '": 반복단위 밖 앵커(' + aid + ') — 건너뜀'); return; }
      mappings.push({ slot: slot, u: ui, path: path });
    });

    return { parent: parent, unitEls: unitEls, mappings: mappings };
  }

  // 선해석 결과를 적용(clone·remove·insert). insertRef 는 적용 시점 라이브 계산
  // 이라 다른 그룹의 선행 변형이 반영돼 순서 의존이 없다.
  function _applyDocxRepeatResolved(resolved, sessions, warnings) {
    var unitEls = resolved.unitEls, mappings = resolved.mappings, parent = resolved.parent;
    if (!unitEls || unitEls.length === 0) return;
    var N = sessions.length;
    if (N < 1) {
      // 세션 0건 — 반복단위는 두되 세션 슬롯 예시텍스트만 공란화(_nodeAtPath([]) = 요소 자신).
      mappings.forEach(function (m) {
        var tEl = _nodeAtPath(unitEls[m.u], m.path);
        if (tEl) _docxSetText(tEl, '');
      });
      return;
    }
    var lastUnit = unitEls[unitEls.length - 1];
    var insertRef = lastUnit.nextSibling;   // 라이브 — 선행 그룹 변형 반영 (insertRef null → append)
    var newNodes = [];
    for (var s = 0; s < N; s++) {
      var clones = unitEls.map(function (u) { return u.cloneNode(true); });
      mappings.forEach(function (m) {
        var tEl = _nodeAtPath(clones[m.u], m.path);
        if (tEl) _docxSetText(tEl, _slotValue(sessions[s], m.slot.id));
      });
      for (var k = 0; k < clones.length; k++) newNodes.push(clones[k]);
    }
    unitEls.forEach(function (u) { if (u.parentNode) u.parentNode.removeChild(u); });
    newNodes.forEach(function (nd) { parent.insertBefore(nd, insertRef); });
  }

  // ========================================================================
  // renderDocx(templateArrayBuffer, filledData, slotSchema, opts?) -> Blob
  // ========================================================================
  function renderDocx(templateArrayBuffer, filledData, slotSchema, opts) {
    var PizZipCtor = _resolvePizZip(opts);
    var DOMParserCtor = _resolveDOMParser(opts);
    var XMLSerializerCtor = _resolveXMLSerializer(opts);

    var schema = _normSchema(slotSchema);
    var report = (filledData && filledData.report) || {};
    var sessions = (filledData && Array.isArray(filledData.sessions)) ? filledData.sessions : [];
    var warnings = [];

    var zip = new PizZipCtor(templateArrayBuffer);
    var entry = zip.file('word/document.xml');
    if (!entry) throw new Error('report-template-renderer: word/document.xml 없음 — .docx 가 아닌 듯합니다.');
    var xml = entry.asText();

    var doc = new DOMParserCtor().parseFromString(xml, 'application/xml');
    var body = (doc.getElementsByTagName('w:body')[0])
      || (doc.documentElement ? doc.documentElement.getElementsByTagName('w:body')[0] : null)
      || doc.documentElement;

    var groupById = {};
    schema.repeat_groups.forEach(function (g) { if (g && g.id) groupById[g.id] = g; });

    // 1) 리포트 레벨 슬롯 — 직접 치환(구조 변경 없음). 세션 슬롯은 여기서 제외.
    var reportMap = _buildDocxBlockMap(body);
    schema.slots.forEach(function (slot) {
      if (slot.repeat_group && groupById[slot.repeat_group]) return;  // 세션 슬롯
      var aid = _anchorRef(slot);
      if (!aid) return;
      var entryEl = reportMap[aid];
      if (!entryEl) { warnings.push('report slot "' + slot.id + '": 앵커 ' + aid + ' 미발견'); return; }
      _docxSetText(entryEl.el, _slotValue(report, slot.id));
    });

    // 2) 세션 반복 그룹 — 변형 전 전부 참조 선해석 → 그다음 적용(다중그룹 오배치 방지).
    //    reportMap 은 step1 이전(구조 변경 전) 스냅샷 — 텍스트 치환은 구조를 안 바꾸므로
    //    여기서 재사용해도 요소 참조 유효. 재빌드하지 않는 것이 버그1 수정의 핵심.
    var _resolvedGroups = [];
    schema.repeat_groups.forEach(function (group) {
      if (!group || !group.id) return;
      if (!Array.isArray(group.docx_block_range)) return;  // xlsx 전용 그룹이면 스킵
      var groupSlots = schema.slots.filter(function (s) { return s.repeat_group === group.id; });
      var resolved = _resolveDocxRepeat(reportMap, body, group, groupSlots, warnings);
      if (resolved) _resolvedGroups.push(resolved);
    });
    _resolvedGroups.forEach(function (resolved) {
      _applyDocxRepeatResolved(resolved, sessions, warnings);
    });

    // 3) 직렬화 → zip 재기록 → 출력.
    var newXml = new XMLSerializerCtor().serializeToString(doc);
    if (!/^\s*<\?xml/.test(newXml)) {
      newXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + newXml;
    }
    zip.file('word/document.xml', newXml);

    var out = _zipOutput(zip, opts);
    return _attachInfo(out, {
      format: 'docx', version: RENDERER_VERSION,
      sessionsRendered: sessions.length, truncated: false, truncatedSessions: 0,
      warnings: warnings
    }, opts);
  }

  // ========================================================================
  // XLSX 셀 주입 (스타일 보존 — .s 유지, .v 만 교체, !ref 확장)
  // ========================================================================
  function _xlsxSetCell(ws, U, addr, value, srcStyle) {
    var prev = ws[addr];
    var cell = { t: 's', v: (value == null ? '' : String(value)) };
    if (prev && prev.s !== undefined) cell.s = prev.s;        // 대상 기존 스타일 우선 보존
    else if (srcStyle !== undefined) cell.s = srcStyle;        // 없으면 세션0 원본 스타일 상속(P1)
    ws[addr] = cell;
    var rc = U.decode_cell(addr);
    var ref = ws['!ref'];
    if (!ref) { ws['!ref'] = addr + ':' + addr; return; }
    var rng = U.decode_range(ref);
    if (rc.r < rng.s.r) rng.s.r = rc.r;
    if (rc.c < rng.s.c) rng.s.c = rc.c;
    if (rc.r > rng.e.r) rng.e.r = rc.r;
    if (rc.c > rng.e.c) rng.e.c = rc.c;
    ws['!ref'] = U.encode_range(rng);
  }

  // ========================================================================
  // renderXlsx(templateArrayBuffer, filledData, slotSchema, opts?) -> Blob
  // ========================================================================
  function renderXlsx(templateArrayBuffer, filledData, slotSchema, opts) {
    var XLSXlib = _resolveXLSX(opts);
    var U = XLSXlib.utils;

    var schema = _normSchema(slotSchema);
    var report = (filledData && filledData.report) || {};
    var sessions = (filledData && Array.isArray(filledData.sessions)) ? filledData.sessions : [];
    var warnings = [];
    var truncatedSessions = 0;

    var data = (templateArrayBuffer instanceof Uint8Array) ? templateArrayBuffer : new Uint8Array(templateArrayBuffer);
    var wb = XLSXlib.read(data, { type: 'array', cellStyles: true, cellDates: true });

    function sheetOf(name) {
      if (name && wb.Sheets[name]) return wb.Sheets[name];
      return wb.Sheets[wb.SheetNames[0]];
    }

    var groupById = {};
    schema.repeat_groups.forEach(function (g) { if (g && g.id) groupById[g.id] = g; });

    // 1) 리포트 레벨 슬롯 — 직접 셀 주입(병합 앵커면 좌상단 셀에 기록).
    schema.slots.forEach(function (slot) {
      if (slot.repeat_group && groupById[slot.repeat_group]) return;
      var ac = _anchorCell(slot);
      if (!ac.cell) return;
      var ws = sheetOf(ac.sheet);
      if (!ws) { warnings.push('report slot "' + slot.id + '": 시트 미발견'); return; }
      _xlsxSetCell(ws, U, ac.cell, _slotValue(report, slot.id));
    });

    // 2) 세션 반복 그룹 — 전치(가로 열그룹) 또는 세로(행 반복) 판별 후 shift.
    //    · xlsx_column_pattern.session_cols → 회차가 가로 열그룹(전치 매트릭스)
    //    · xlsx_row_pattern.session_rows    → 회차가 세로 행(발주처 세로형 양식). 1-based 시트행.
    //    axis 필드가 있으면 우선. P1: 세션0 셀 스타일(.s)을 shift 대상에 상속(병합 전파는 보류).
    schema.repeat_groups.forEach(function (group) {
      if (!group || !group.id) return;
      var groupSlots = schema.slots.filter(function (s) { return s.repeat_group === group.id; });

      var rowPat = group.xlsx_row_pattern;
      var colPat = group.xlsx_column_pattern;
      var useRow = !!(rowPat && Array.isArray(rowPat.session_rows) && rowPat.session_rows.length) && (group.axis !== 'col');
      var useCol = !useRow && !!(colPat && Array.isArray(colPat.session_cols) && colPat.session_cols.length);
      if (!useRow && !useCol) return; // docx 전용/미지정 그룹이면 스킵

      // --- 세로 행 반복 모드 (버그2 수정: 회차=행) ---
      if (useRow) {
        var rowNum = function (x) { var n = parseInt(x, 10); return isNaN(n) ? -1 : (n - 1); }; // 1-based → 0-based
        var rows = rowPat.session_rows.map(function (g) { return Array.isArray(g) ? g : [g]; });
        var availR = rows.length;
        var wsR = sheetOf(rowPat.sheet);
        if (!wsR) { warnings.push('repeat group "' + group.id + '": 시트 미발견'); return; }
        if (sessions.length > availR) {
          truncatedSessions += (sessions.length - availR);
          warnings.push('repeat group "' + group.id + '": 세션 ' + sessions.length +
            '개 > 행그룹 ' + availR + '개 — 초과 ' + (sessions.length - availR) + '개 세션 잘림');
        }
        var renderR = Math.min(sessions.length, availR);
        for (var ir = 0; ir < renderR; ir++) {
          groupSlots.forEach(function (slot) {
            var acR = _anchorCell(slot);
            if (!acR.cell) return;
            var rcR;
            try { rcR = U.decode_cell(acR.cell); } catch (e) { warnings.push('session slot "' + slot.id + '": 잘못된 anchor.cell ' + acR.cell); return; }
            var gr0 = -1, offR = -1;
            for (var gri = 0; gri < rows.length && gr0 < 0; gri++) {
              for (var kr = 0; kr < rows[gri].length; kr++) {
                if (rowNum(rows[gri][kr]) === rcR.r) { gr0 = gri; offR = kr; break; }
              }
            }
            if (gr0 < 0) { warnings.push('session slot "' + slot.id + '": anchor 행이 session_rows 밖 — 건너뜀'); return; }
            var grpR = rows[ir];
            var targetRow = rowNum(grpR[Math.min(offR, grpR.length - 1)]);
            if (targetRow < 0) { warnings.push('session slot "' + slot.id + '": session_rows 행번호 오류'); return; }
            var srcObjR = wsR[acR.cell];
            var srcStyleR = srcObjR ? srcObjR.s : undefined;   // P1 스타일 상속
            var targetAddrR = U.encode_cell({ r: targetRow, c: rcR.c });
            _xlsxSetCell(wsR, U, targetAddrR, _slotValue(sessions[ir], slot.id), srcStyleR);
          });
        }
        return;
      }

      // --- 가로 전치 열그룹 모드 (기존) ---
      var pat = colPat;
      var cols = pat.session_cols;             // [["C","D"],["E","F"],...]
      var avail = cols.length;
      var ws = sheetOf(pat.sheet);
      if (!ws) { warnings.push('repeat group "' + group.id + '": 시트 미발견'); return; }
      if (sessions.length > avail) {
        truncatedSessions += (sessions.length - avail);
        warnings.push('repeat group "' + group.id + '": 세션 ' + sessions.length +
          '개 > 열그룹 ' + avail + '개 — 초과 ' + (sessions.length - avail) + '개 세션 잘림');
      }
      var render = Math.min(sessions.length, avail);
      for (var i = 0; i < render; i++) {
        groupSlots.forEach(function (slot) {
          var ac = _anchorCell(slot);
          if (!ac.cell) return;
          var rc;
          try { rc = U.decode_cell(ac.cell); } catch (e) { warnings.push('session slot "' + slot.id + '": 잘못된 anchor.cell ' + ac.cell); return; }
          // 원본 앵커 열이 어느 열그룹의 몇 번째 열인지 찾기.
          var g0 = -1, off = -1;
          for (var gi = 0; gi < cols.length && g0 < 0; gi++) {
            for (var k = 0; k < cols[gi].length; k++) {
              if (U.decode_col(String(cols[gi][k])) === rc.c) { g0 = gi; off = k; break; }
            }
          }
          if (g0 < 0) { warnings.push('session slot "' + slot.id + '": anchor 열이 session_cols 밖 — 건너뜀'); return; }
          var grp = cols[i];
          var colLetter = grp[Math.min(off, grp.length - 1)];
          var targetCol = U.decode_col(String(colLetter));
          var srcObj = ws[ac.cell];
          var srcStyle = srcObj ? srcObj.s : undefined;   // P1 스타일 상속
          var targetAddr = U.encode_cell({ r: rc.r, c: targetCol });
          _xlsxSetCell(ws, U, targetAddr, _slotValue(sessions[i], slot.id), srcStyle);
        });
      }
    });

    var out = _xlsxOutput(wb, XLSXlib, opts);
    return _attachInfo(out, {
      format: 'xlsx', version: RENDERER_VERSION,
      sessionsRendered: sessions.length - truncatedSessions,
      truncated: truncatedSessions > 0, truncatedSessions: truncatedSessions,
      warnings: warnings
    }, opts);
  }

  // ========================================================================
  // 출력 헬퍼 — 브라우저: Blob / Node: nodebuffer|Buffer. renderInfo 부착.
  // ========================================================================
  function _wantBuffer(opts) {
    if (opts && opts.outputType === 'buffer') return true;
    if (opts && opts.outputType === 'blob') return false;
    return typeof Blob === 'undefined';
  }
  function _zipOutput(zip, opts) {
    if (_wantBuffer(opts)) return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    return zip.generate({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
  }
  function _xlsxOutput(wb, XLSXlib, opts) {
    var wbout = XLSXlib.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
    var u8 = new Uint8Array(wbout);
    if (_wantBuffer(opts)) return (typeof Buffer !== 'undefined') ? Buffer.from(u8) : u8;
    return new Blob([u8], { type: XLSX_MIME });
  }
  // renderInfo(경고·잘림·세션수)를 반환 Blob/Buffer 에 부착 + opts.onInfo 콜백.
  function _attachInfo(out, info, opts) {
    try { out.renderInfo = info; } catch (e) { /* 일부 환경 non-extensible — 무시 */ }
    if (opts && typeof opts.onInfo === 'function') { try { opts.onInfo(info); } catch (e) {} }
    return out;
  }

  // ========================================================================
  // renderReport(format, ...) 디스패처. hwp 는 미지원 throw(확장 스텁).
  // ========================================================================
  function renderReport(format, templateArrayBuffer, filledData, slotSchema, opts) {
    var f = String(format || '').toLowerCase();
    if (f === 'docx' || f === 'doc') return renderDocx(templateArrayBuffer, filledData, slotSchema, opts);
    if (f === 'xlsx' || f === 'xls') return renderXlsx(templateArrayBuffer, filledData, slotSchema, opts);
    if (f === 'hwp') throw new Error('report-template-renderer: hwp 렌더링은 아직 미지원입니다(확장 스텁 — 별도 브리프).');
    throw new Error('report-template-renderer: 지원하지 않는 format "' + format + '" (docx|xlsx).');
  }

  return {
    RENDERER_VERSION: RENDERER_VERSION,
    renderReport: renderReport,
    renderDocx: renderDocx,
    renderXlsx: renderXlsx,
    // 파일명/날짜 유틸 (index.html 참고 자체 포함) + 테스트용 내부 소도구 노출.
    sanitizeFilename: sanitizeFilename,
    fmtKDate: fmtKDate,
    _util: {
      buildDocxBlockMap: _buildDocxBlockMap,
      docxSetText: _docxSetText,
      xlsxSetCell: _xlsxSetCell,
      normSchema: _normSchema,
      resolveDocxRepeat: _resolveDocxRepeat,
      applyDocxRepeatResolved: _applyDocxRepeatResolved
    }
  };
});
