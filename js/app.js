/* 게임 정보 모음 - 정적 사이트 + GitHub API 저장
 * 읽기: data/posts.json 을 그대로 불러옴 (누구나)
 * 쓰기: 관리자가 GitHub 토큰을 입력하면 저장소에 직접 커밋 (DB 대신 git 이 저장소)
 */
const $ = s => document.querySelector(s);
const CFG = window.SITE_CONFIG || {};
const seg = location.pathname.split('/').filter(Boolean)[0] || '';
const OWNER = CFG.owner || location.hostname.split('.')[0];
const REPO = CFG.repo || ((!seg || seg.includes('.')) ? location.hostname : seg);
const BRANCH = CFG.branch || 'main';
const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
const DATA = 'data/posts.json';

let D = null, sha = null, token = '', admin = false;
let cat = 'all', kw = '';
try { token = localStorage.getItem('gi_token') || ''; } catch (e) {}

/* ---------- 유틸 ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const b64d = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, '')), c => c.charCodeAt(0)));
const b64e = s => { let b = ''; new TextEncoder().encode(s).forEach(c => b += String.fromCharCode(c)); return btoa(b); };
function toast(t) {
  const e = $('#toast'); e.textContent = t; e.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => e.style.display = 'none', 3500);
}
const inl = s => s
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
function md(src) {
  let h = '', ul = false; const cl = () => { if (ul) { h += '</ul>'; ul = false; } };
  for (const l of esc(src).split('\n')) {
    let m;
    if (m = l.match(/^!\[([^\]]*)\]\((images\/[\w.-]+|https:\/\/[^\s)]+)\)$/)) { cl(); h += `<img src="${m[2]}" alt="${m[1]}" loading="lazy">`; }
    else if (m = l.match(/^(#{1,3}) (.+)/)) { cl(); h += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`; }
    else if (m = l.match(/^[-*] (.+)/)) { if (!ul) { h += '<ul>'; ul = true; } h += `<li>${inl(m[1])}</li>`; }
    else if (m = l.match(/^&gt; (.+)/)) { cl(); h += `<blockquote>${inl(m[1])}</blockquote>`; }
    else if (!l.trim()) cl();
    else { cl(); h += `<p>${inl(l)}</p>`; }
  }
  cl(); return h;
}

/* ---------- GitHub API ---------- */
const hdr = () => ({ Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json' });
async function ghGet(path) {
  const r = await fetch(`${API}${path}?ref=${BRANCH}&t=${Date.now()}`, { headers: hdr() });
  if (!r.ok) throw Object.assign(new Error('GitHub ' + r.status), { status: r.status });
  return r.json();
}
async function ghPut(path, b64, message, fileSha) {
  const body = { message, content: b64, branch: BRANCH };
  if (fileSha) body.sha = fileSha;
  const r = await fetch(API + path, { method: 'PUT', headers: { ...hdr(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || 'GitHub ' + r.status), { status: r.status });
  return j;
}
async function save(msg) {
  try {
    const r = await ghPut(DATA, b64e(JSON.stringify(D, null, 1)), msg, sha);
    sha = r.content.sha;
    toast('저장됨 · 다른 사람에게 보이기까지 1~2분 걸립니다');
    return true;
  } catch (e) {
    toast(e.status === 409 || e.status === 422
      ? '다른 곳에서 먼저 수정됐어요. 새로고침 후 다시 시도하세요'
      : '저장 실패: ' + e.message);
    return false;
  }
}
async function shrink(file) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, 1280 / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82).split(',')[1];
}

/* ---------- 로드 ---------- */
async function load() {
  if (token) {
    try {
      const f = await ghGet(DATA);
      D = JSON.parse(b64d(f.content)); sha = f.sha; admin = true;
    } catch (e) {
      token = ''; admin = false; try { localStorage.removeItem('gi_token'); } catch (_) {}
      toast('토큰이 유효하지 않아 관리자 모드를 해제했습니다');
    }
  }
  if (!D) {
    try { D = await (await fetch(DATA + '?v=' + Date.now())).json(); }
    catch (e) { D = { title: '불러오기 실패', cats: [], posts: [] }; }
  }
  render();
}

/* ---------- 모달 ---------- */
function ask(label, val = '', type = 'text') {
  return new Promise(res => {
    $('#box').innerHTML = `<label>${esc(label)}</label><input id="ai" type="${type}" value="${esc(val)}"><div class="row"><button id="aN">취소</button><button class="p" id="aY">확인</button></div>`;
    $('#modal').className = 'on'; const i = $('#ai'); i.focus();
    const done = v => { $('#modal').className = ''; res(v); };
    $('#aN').onclick = () => done(null); $('#aY').onclick = () => done(i.value);
    i.onkeydown = e => { if (e.key === 'Enter') done(i.value); };
  });
}

/* ---------- 렌더 ---------- */
const cn = id => (D.cats.find(c => c.id === id) || { name: '기타' }).name;
const list = () => D.posts
  .filter(p => (cat === 'all' || p.cat === cat) && (!kw || (p.title + p.body).toLowerCase().includes(kw)))
  .sort((a, b) => (!!b.pin - !!a.pin) || b.upd.localeCompare(a.upd));

function render() {
  if (!D) return;
  $('#ttl').textContent = D.title; document.title = D.title;
  $('#admBtn').textContent = admin ? '관리자 해제' : '관리자';
  $('#nav').innerHTML =
    `<div class="c"><button data-a="cat" data-id="all" class="${cat === 'all' ? 'on' : ''}">전체 (${D.posts.length})</button></div>` +
    D.cats.map(c => `<div class="c"><button data-a="cat" data-id="${c.id}" class="${cat === c.id ? 'on' : ''}">${esc(c.name)} (${D.posts.filter(p => p.cat === c.id).length})</button>${admin ? `<button class="x" data-a="rc" data-id="${c.id}">✎</button>` : ''}</div>`).join('');
  const op = D.posts.find(p => p.id === location.hash.slice(1));
  let o = '';
  if (admin) o += `<div class="adm"><b>관리자 모드</b><button class="p" data-a="new">+ 새 글</button><button data-a="ac">+ 카테고리</button><button data-a="rt">사이트 제목</button></div>`;
  if (op) {
    o += `<button data-a="back" style="margin-bottom:10px">← 목록</button><article><span class="tag">${esc(cn(op.cat))}</span><span class="meta">${op.upd}${admin ? ` · ID: ${op.id}` : ''}</span><h2>${esc(op.title)}</h2><div class="body">${md(op.body)}</div>${admin ? `<div class="row"><button data-a="edit" data-id="${op.id}">수정</button></div>` : ''}</article>`;
  } else {
    const L = list();
    o += L.length ? L.map(p => `<div class="card" data-a="open" data-id="${p.id}"><h3>${p.pin ? '📌 ' : ''}${esc(p.title)}</h3><div class="meta"><span class="tag">${esc(cn(p.cat))}</span>${p.upd}</div><div class="sn">${esc(p.body.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/[#*`>\[\]]/g, '').slice(0, 160))}</div></div>`).join('') : '<div class="empty">글이 없습니다</div>';
  }
  $('#main').innerHTML = o;
}

/* ---------- 에디터 ---------- */
function editor(id) {
  const p = id ? D.posts.find(x => x.id === id) : { id: '', cat: D.cats[0] && D.cats[0].id, title: '', body: '', pin: false };
  $('#box').innerHTML = `<label>제목</label><input type="text" id="et" value="${esc(p.title)}"><label>카테고리</label><select id="ec">${D.cats.map(c => `<option value="${c.id}" ${c.id === p.cat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><label>내용 (# 제목, ## 소제목, - 목록, **굵게**, [링크](주소), &gt; 인용)</label><textarea id="eb">${esc(p.body)}</textarea><div style="margin-top:6px"><button id="eI">🖼 이미지 추가</button><input type="file" id="ef" accept="image/*" hidden></div><label><input type="checkbox" id="ep" ${p.pin ? 'checked' : ''}> 상단 고정</label><div class="row">${id ? '<button class="d" id="eD">삭제</button>' : ''}<button id="eN">취소</button><button class="p" id="eS">저장</button></div>`;
  $('#modal').className = 'on';
  $('#eN').onclick = () => $('#modal').className = '';
  $('#eI').onclick = () => $('#ef').click();
  $('#ef').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    const btn = $('#eI'); btn.disabled = true; btn.textContent = '업로드 중...';
    try {
      const path = 'images/' + Date.now().toString(36) + '.jpg';
      await ghPut(path, await shrink(f), '이미지 추가', null);
      const ta = $('#eb'), i = ta.selectionStart;
      const ins = `\n![](${path})\n`;
      ta.value = ta.value.slice(0, i) + ins + ta.value.slice(i);
      toast('이미지 추가됨 (글 저장 후 1~2분 뒤 표시)');
    } catch (err) { toast('이미지 업로드 실패: ' + err.message); }
    btn.disabled = false; btn.textContent = '🖼 이미지 추가'; e.target.value = '';
  };
  if (id) $('#eD').onclick = async () => {
    if (!confirm('이 글을 삭제할까요?')) return;
    D.posts = D.posts.filter(x => x.id !== id); location.hash = '';
    if (await save('글 삭제: ' + p.title)) { $('#modal').className = ''; render(); }
  };
  $('#eS').onclick = async () => {
    const t = $('#et').value.trim(); if (!t) { toast('제목을 입력하세요'); return; }
    Object.assign(p, { title: t, cat: $('#ec').value, body: $('#eb').value, pin: $('#ep').checked, upd: new Date().toISOString().slice(0, 10) });
    if (!p.id) { p.id = 'p' + Date.now().toString(36); D.posts.push(p); }
    $('#eS').disabled = true;
    if (await save('글 저장: ' + t)) { $('#modal').className = ''; location.hash = p.id; render(); }
    $('#eS').disabled = false;
  };
}

/* ---------- 이벤트 ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-a]'); if (!t) return;
  const a = t.dataset.a, id = t.dataset.id;
  if (a === 'cat') { cat = id; location.hash = ''; render(); }
  else if (a === 'open') location.hash = id;
  else if (a === 'back') location.hash = '';
  else if (a === 'new') editor();
  else if (a === 'edit') editor(id);
  else if (a === 'ac') {
    const n = await ask('새 카테고리 이름');
    if (n && n.trim()) { D.cats.push({ id: 'c' + Date.now().toString(36), name: n.trim() }); await save('카테고리 추가'); render(); }
  } else if (a === 'rc') {
    const c = D.cats.find(x => x.id === id);
    const n = await ask('카테고리 이름 (비우면 삭제)', c.name); if (n === null) return;
    if (!n.trim()) {
      if (D.posts.some(p => p.cat === id)) { toast('글이 있는 카테고리는 삭제할 수 없습니다'); return; }
      D.cats = D.cats.filter(x => x.id !== id); cat = 'all';
    } else c.name = n.trim();
    await save('카테고리 수정'); render();
  } else if (a === 'rt') {
    const n = await ask('사이트 제목', D.title);
    if (n && n.trim()) { D.title = n.trim(); await save('제목 변경'); render(); }
  }
});
$('#ttl').onclick = () => { location.hash = ''; cat = 'all'; render(); };
$('#q').oninput = e => { kw = e.target.value.trim().toLowerCase(); location.hash = ''; render(); };
window.addEventListener('hashchange', render);
$('#admBtn').onclick = async () => {
  if (admin) {
    admin = false; token = ''; try { localStorage.removeItem('gi_token'); } catch (e) {}
    D = null; await load(); return;
  }
  const t = await ask('GitHub 토큰 (README 참고)', '', 'password');
  if (!t || !t.trim()) return;
  token = t.trim();
  try { localStorage.setItem('gi_token', token); } catch (e) {}
  D = null; await load();
  if (admin) toast('관리자 모드 켜짐');
};
load();
