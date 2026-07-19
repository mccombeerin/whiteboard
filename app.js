/**
 * TutorBlocks v2 — app.js
 */

/* ═══════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════ */

const SESSION_ID = getOrCreateSessionId();

const PRESET_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L',
                        'M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z'];
const PRESET_WORDS   = ['cat','dog','hat','bat','sun','run','big',
                        'red','sit','hop','yes','no','up','on','in','at'];
const BLOCK_COLORS   = ['#3b82f6','#22c55e','#f97316','#a855f7',
                        '#ef4444','#14b8a6','#ec4899','#64748b'];
const SNAP_THRESHOLD = 50;

/* ═══════════════════════════════════════════
   STATE
═══════════════════════════════════════════ */

let supabaseClient = null;
let channel        = null;
let isTutor        = true;
let selectedColor  = BLOCK_COLORS[0];
let popupText      = '';
let formatBold     = false;
let formatUnderline = false;

const blocks    = {};
const dropZones = {};

/* ═══════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════ */

const $ = id => document.getElementById(id);

function getOrCreateSessionId() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('session')) return params.get('session');
  let id = sessionStorage.getItem('tb_session');
  if (!id) { id = Math.random().toString(36).slice(2,8).toUpperCase(); sessionStorage.setItem('tb_session', id); }
  return id;
}

let toastTimer;
function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), duration);
}

function updateOnlineCount(n) {
  const el = $('online-count');
  if (el) el.textContent = n + ' online';
}

/* ═══════════════════════════════════════════
   BOOT — show canvas immediately, connect in background
═══════════════════════════════════════════ */


/* ═══════════════════════════════════════════
   RICH TEXT EDITOR — per-character formatting
═══════════════════════════════════════════ */

function applyFormat(cmd) {
  // cmd: 'bold' or 'underline'
  // Uses document.execCommand on the contenteditable editor
  const editor = document.getElementById('rich-editor');
  if (!editor) return;
  editor.focus();
  document.execCommand(cmd, false, null);
  // Update button active state
  const boldActive = document.queryCommandState('bold');
  const ulActive   = document.queryCommandState('underline');
  const boldBtn = document.getElementById('fmt-bold');
  const ulBtn   = document.getElementById('fmt-underline');
  if (boldBtn) boldBtn.classList.toggle('active', boldActive);
  if (ulBtn)   ulBtn.classList.toggle('active', ulActive);
}

window.addEventListener('DOMContentLoaded', boot);

async function boot() {
  isTutor = true;
  showApp();

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
    connectToSession();
  } catch(e) {
    console.warn('[TutorBlocks] Supabase init failed:', e);
  }

  initZoomSdk().catch(e => console.warn('[TutorBlocks] Zoom SDK:', e));
}

async function connectToSession() {
  return new Promise((resolve) => {
    channel = supabaseClient.channel('session:' + SESSION_ID, {
      config: { presence: { key: crypto.randomUUID() } },
    });
    channel
      .on('presence', { event: 'sync' }, () => {
        updateOnlineCount(Object.keys(channel.presenceState()).length);
      })
      .on('broadcast', { event: 'canvas_update' }, ({ payload }) => {
        handleRemoteUpdate(payload);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({ joinedAt: Date.now() });
          resolve();
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') resolve();
      });
    setTimeout(resolve, 4000);
  });
}

/* ═══════════════════════════════════════════
   ZOOM SDK
═══════════════════════════════════════════ */

let zoomReady = false;

async function initZoomSdk() {
  if (typeof zoomSdk === 'undefined') return;
  try {
    await zoomSdk.config({ capabilities: ['getMeetingContext','getUserContext','sendAppInvitation'], version: '0.16' });
    zoomReady = true;
  } catch(e) {
    console.warn('[TutorBlocks] Zoom SDK config failed:', e);
  }
}

async function sendZoomInvitation() {
  if (!zoomReady) return;
  try { await zoomSdk.sendAppInvitation({ participants: [] }); } catch(e) {}
}

/* ═══════════════════════════════════════════
   SHOW APP
═══════════════════════════════════════════ */

function showApp() {
  const pill = $('role-pill');
  if (pill) { pill.textContent = 'Whiteboard'; pill.className = 'role-pill tutor'; }
  buildToolbar();
  buildPopup();
}

/* ═══════════════════════════════════════════
   TOOLBAR
═══════════════════════════════════════════ */

function buildToolbar() {
  const tb = $('toolbar');
  tb.innerHTML = '';

  // Add Text Block
  tb.appendChild(makeBtn('+ Text Block', 'primary', () => togglePopup(true)));

  tb.appendChild(makeDivider());

  // Add Drop Zone
  tb.appendChild(makeBtn('+ Drop Zone', 'secondary', () => addDropZone()));

  tb.appendChild(makeDivider());

  // Save Layout
  tb.appendChild(makeBtn('Save Layout', 'secondary', () => openSaveLayoutModal()));

  // My Layouts
  tb.appendChild(makeBtn('My Layouts', 'secondary', () => openLoadLayoutModal()));

  tb.appendChild(makeDivider());

  // Clear All
  tb.appendChild(makeBtn('Clear All', 'danger', async () => {
    const ok = await customConfirm('Remove all blocks and drop zones?');
    if (ok) clearAll();
  }));

  // Re-invite
  const inviteBtn = makeBtn('Re-invite Students', 'secondary', async () => {
    await sendZoomInvitation();
    showToast('Invite sent!');
  });
  inviteBtn.style.marginLeft = 'auto';
  tb.appendChild(inviteBtn);
}

function makeBtn(label, cls, onClick) {
  const btn = document.createElement('button');
  btn.className = 'tb-btn ' + cls;
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function makeDivider() {
  const d = document.createElement('div');
  d.className = 'tb-divider';
  return d;
}

/* ═══════════════════════════════════════════
   POPUP
═══════════════════════════════════════════ */

let freeTextMode = false; // module-level so confirmAddBlock can read it

function buildPopup() {
  const presetsSection  = $('presets-section');
  const freeTextSection = $('free-text-section');
  const editor          = $('rich-editor');
  const editorLabel     = $('editor-label');

  // Build tab row once
  if (!$('popup-tab-row')) {
    const tabRow = document.createElement('div');
    tabRow.id = 'popup-tab-row';
    tabRow.style.cssText = 'display:flex;gap:6px;';

    const btnLetters = document.createElement('button');
    btnLetters.id = 'popup-tab-letters';
    btnLetters.textContent = 'Letters / Words';
    btnLetters.style.cssText = 'flex:1;padding:7px;border-radius:7px;border:none;font-family:Nunito,sans-serif;font-size:12px;font-weight:800;cursor:pointer;background:#3b82f6;color:#fff;';

    const btnFree = document.createElement('button');
    btnFree.id = 'popup-tab-free';
    btnFree.textContent = 'Free Text';
    btnFree.style.cssText = 'flex:1;padding:7px;border-radius:7px;border:none;font-family:Nunito,sans-serif;font-size:12px;font-weight:800;cursor:pointer;background:rgba(255,255,255,0.07);color:#94a3b8;';

    tabRow.appendChild(btnLetters);
    tabRow.appendChild(btnFree);

    const popup  = $('block-popup');
    const title  = popup.querySelector('.pop-title');
    title.after(tabRow);

    btnLetters.addEventListener('click', () => {
      freeTextMode = false;
      btnLetters.style.background = '#3b82f6'; btnLetters.style.color = '#fff';
      btnFree.style.background = 'rgba(255,255,255,0.07)'; btnFree.style.color = '#94a3b8';
      presetsSection.style.display = 'block';
      editorLabel.textContent = 'Type or select a preset above';
      const cs = $('colour-section'); if (cs) cs.style.display = 'block';
    });

    btnFree.addEventListener('click', () => {
      freeTextMode = true;
      btnFree.style.background = '#3b82f6'; btnFree.style.color = '#fff';
      btnLetters.style.background = 'rgba(255,255,255,0.07)'; btnLetters.style.color = '#94a3b8';
      presetsSection.style.display = 'none';
      editorLabel.textContent = 'Type your text';
      const cs = $('colour-section'); if (cs) cs.style.display = 'none';
      setTimeout(() => editor && editor.focus(), 50);
    });
  }

  // Update bold/underline button state when selection changes
  if (editor) {
    editor.addEventListener('keyup',        updateFmtBtnState);
    editor.addEventListener('mouseup',      updateFmtBtnState);
    editor.addEventListener('selectionchange', updateFmtBtnState);
  }
  document.addEventListener('selectionchange', updateFmtBtnState);

  // Letter chips — clicking inserts text into the rich editor
  const chipLetters = $('chip-letters');
  PRESET_LETTERS.forEach(l => {
    const chip = makeChip(l, () => {
      if (editor) { editor.focus(); editor.innerHTML = l; placeCaretAtEnd(editor); }
      chipLetters.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      $('chip-words').querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    chipLetters.appendChild(chip);
  });

  // Word chips
  const chipWords = $('chip-words');
  PRESET_WORDS.forEach(w => {
    const chip = makeChip(w, () => {
      if (editor) { editor.focus(); editor.innerHTML = w; placeCaretAtEnd(editor); }
      chipWords.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chipLetters.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
    chipWords.appendChild(chip);
  });

  // Color swatches
  const swatchRow = $('swatch-row');
  BLOCK_COLORS.forEach(hex => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (hex === selectedColor ? ' active' : '');
    sw.style.background = hex;
    sw.addEventListener('click', () => {
      selectedColor = hex;
      swatchRow.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
    swatchRow.appendChild(sw);
  });

  $('popup-confirm').addEventListener('click', () => confirmAddBlock());
  $('popup-cancel').addEventListener('click',  () => togglePopup(false));
  if (editor) editor.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && freeTextMode) { e.preventDefault(); confirmAddBlock(); }
  });
}

function updateFmtBtnState() {
  const boldBtn = $('fmt-bold');
  const ulBtn   = $('fmt-underline');
  if (boldBtn) boldBtn.classList.toggle('active', document.queryCommandState('bold'));
  if (ulBtn)   ulBtn.classList.toggle('active',   document.queryCommandState('underline'));
}

function placeCaretAtEnd(el) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function makeChip(text, onClick) {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.textContent = text;
  chip.addEventListener('click', onClick);
  return chip;
}

function togglePopup(open) {
  const popup = $('block-popup');
  if (open) {
    popup.classList.add('open');
    setTimeout(() => {
      const editor = $('rich-editor');
      if (editor) { editor.innerHTML = ''; editor.focus(); }
    }, 50);
  } else {
    popup.classList.remove('open');
    const editor = $('rich-editor');
    if (editor) editor.innerHTML = '';
    popupText = '';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    // Reset format buttons
    const boldBtn = $('fmt-bold');
    const ulBtn   = $('fmt-underline');
    if (boldBtn) boldBtn.classList.remove('active');
    if (ulBtn)   ulBtn.classList.remove('active');
  }
}

function confirmAddBlock() {
  const editor = $('rich-editor');
  const html = editor ? editor.innerHTML.trim() : '';
  const plainText = editor ? (editor.innerText || editor.textContent || '').trim() : '';

  if (!plainText) { showToast('Please enter some text'); return; }

  // html contains inline <b> and <u> tags for per-character formatting
  if (freeTextMode) {
    togglePopup(false);
    addBlock(plainText, 'none', null, null, null, {}, html);
  } else {
    togglePopup(false);
    addBlock(plainText, selectedColor, null, null, null, {}, html);
  }
}

/* ═══════════════════════════════════════════
   BLOCKS
═══════════════════════════════════════════ */

function addBlock(text, color, id = null, x = null, y = null, fmt = {}, html = '') {
  const canvas = $('canvas-wrap');
  const blockId = id || 'blk_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  const cx = x ?? (canvas.clientWidth  / 2 - 40 + Math.random() * 80 - 40);
  const cy = y ?? (canvas.clientHeight / 2 - 28 + Math.random() * 80 - 40);
  // Sanitise html — only allow b, u, strong, em, span tags
  const safeHtml = html ? html.replace(/<(?!\/?(?:b|u|strong|em|span)[>\s])[^>]+>/gi, '') : '';
  const data = { id: blockId, text, color, x: cx, y: cy, snappedTo: null, fmt, html: safeHtml };
  blocks[blockId] = data;
  renderBlock(data);
  if (!id) broadcast({ type: 'add_block', ...data });
}

function renderBlock(data) {
  document.getElementById(data.id)?.remove();
  const el = document.createElement('div');
  el.id = data.id;
  el.style.left = data.x + 'px';
  el.style.top  = data.y + 'px';

  if (data.color === 'none') {
    // Plain text block — outer el is overflow:visible for remove button
    el.className = 'text-block text-plain';
    el.style.cssText += ';background:transparent;border:none;box-shadow:none;padding:0;overflow:visible;display:block;';
    el.style.width  = (data.w || 160) + 'px';
    el.style.height = (data.h || 60)  + 'px';

    // Use a textarea for native resize support
    const ta = document.createElement('textarea');
    ta.value = data.text || '';
    ta.readOnly = true; // not editable once placed
    ta.style.cssText = [
      'width:100%',
      'height:100%',
      'min-width:80px',
      'min-height:40px',
      'resize:both',
      'overflow:auto',
      'border:2px dashed rgba(0,0,0,0.25)',
      'border-radius:6px',
      'padding:6px 10px',
      'box-sizing:border-box',
      'background:transparent',
      'color:#1a202c',
      'font-family:Nunito,sans-serif',
      'font-weight:500',
      'font-size:18px',
      'line-height:1.4',
      'cursor:grab',
      'outline:none',
      'display:block',
    ].join(';');
    el.appendChild(ta);

    // Scale font as textarea is resized
    new ResizeObserver(() => {
      const w = ta.offsetWidth;
      const h = ta.offsetHeight;
      el.style.width  = w + 'px';
      el.style.height = h + 'px';
      const size = Math.max(10, Math.min(Math.floor(h * 0.4), Math.floor(w * 0.15)));
      ta.style.fontSize = size + 'px';
    }).observe(ta);

  } else {
    el.className = 'text-block';
    el.style.background = data.color;
  }

  // Put rich content into the right container
  if (data.color === 'none') {
    // textarea already has value set above — nothing to do here
  } else if (data.html) {
    el.innerHTML = data.html;
  } else {
    el.textContent = data.text;
  }

  const rm = document.createElement('div');
  rm.className = 'blk-remove';
  rm.textContent = 'x';
  rm.addEventListener('click', e => { e.stopPropagation(); removeBlock(data.id); });
  el.appendChild(rm);

  makeDraggable(el, data.id, 'block');
  $('canvas').appendChild(el);
}

function removeBlock(id) {
  delete blocks[id];
  document.getElementById(id)?.remove();
  broadcast({ type: 'remove_block', id });
}

/* ═══════════════════════════════════════════
   DROP ZONES
═══════════════════════════════════════════ */

function addDropZone(id = null, x = null, y = null, locked = false) {
  const canvas = $('canvas-wrap');
  const zoneId = id || 'dz_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  const cx = x ?? (canvas.clientWidth  / 2 - 60 + Math.random() * 80 - 40);
  const cy = y ?? (canvas.clientHeight / 2 - 45 + Math.random() * 80 - 40);
  const data = { id: zoneId, x: cx, y: cy, locked };
  dropZones[zoneId] = data;
  renderDropZone(data);
  if (!id) broadcast({ type: 'add_zone', ...data });
}

function renderDropZone(data) {
  document.getElementById(data.id)?.remove();
  const el = document.createElement('div');
  el.className = 'drop-zone' + (data.locked ? ' dz-locked' : '');
  el.id = data.id;
  el.style.left = data.x + 'px';
  el.style.top  = data.y + 'px';

  // Label — hide if occupied
  const label = document.createElement('div');
  label.className = 'dz-label';
  label.textContent = 'Drop here';
  const occupied = Object.values(blocks).some(b => b && b.snappedTo === data.id);
  label.style.display = occupied ? 'none' : 'block';
  el.appendChild(label);

  // Lock button (tutor only)
  const lockBtn = document.createElement('div');
  lockBtn.className = 'dz-lock';
  lockBtn.textContent = data.locked ? 'LOCKED' : 'LOCK';
  lockBtn.title = data.locked ? 'Click to unlock' : 'Click to lock in place';
  lockBtn.addEventListener('click', e => { e.stopPropagation(); toggleDropZoneLock(data.id); });
  el.appendChild(lockBtn);

  // Remove button (tutor only)
  const rm = document.createElement('div');
  rm.className = 'dz-remove';
  rm.textContent = 'x';
  rm.addEventListener('click', e => { e.stopPropagation(); removeDropZone(data.id); });
  el.appendChild(rm);

  makeDraggable(el, data.id, 'zone');
  $('canvas').appendChild(el);
}

function toggleDropZoneLock(id) {
  const z = dropZones[id];
  if (!z) return;
  z.locked = !z.locked;
  renderDropZone(z);
  broadcast({ type: 'lock_zone', id, locked: z.locked });
}

function removeDropZone(id) {
  delete dropZones[id];
  document.getElementById(id)?.remove();
  broadcast({ type: 'remove_zone', id });
}

/* ═══════════════════════════════════════════
   CLEAR ALL
═══════════════════════════════════════════ */

function clearAll() {
  Object.keys(blocks).forEach(id => { document.getElementById(id)?.remove(); delete blocks[id]; });
  Object.keys(dropZones).forEach(id => { document.getElementById(id)?.remove(); delete dropZones[id]; });
  broadcast({ type: 'clear_all' });
}

/* ═══════════════════════════════════════════
   DRAG & SNAP
═══════════════════════════════════════════ */

function makeDraggable(el, objectId, objectType) {
  let startX, startY, startLeft, startTop, dragging = false;

  el.addEventListener('pointerdown', e => {
    if (e.target.classList.contains('blk-remove') ||
        e.target.classList.contains('dz-remove') ||
        e.target.classList.contains('dz-lock')) return;
    if (objectType === 'zone' && dropZones[objectId] && dropZones[objectId].locked) return;

    // If clicking on a textarea's resize handle (bottom-right 16px corner), let browser handle it
    if (e.target.tagName === 'TEXTAREA') {
      const rect = e.target.getBoundingClientRect();
      const inResizeCorner = (e.clientX > rect.right - 16) && (e.clientY > rect.bottom - 16);
      if (inResizeCorner) return;
    }

    e.preventDefault();
    dragging = true;
    el.setPointerCapture(e.pointerId);
    startX = e.clientX; startY = e.clientY;
    startLeft = parseFloat(el.style.left) || 0;
    startTop  = parseFloat(el.style.top)  || 0;
    el.style.zIndex = '100';
  });

  el.addEventListener('pointermove', e => {
    if (!dragging) return;
    e.preventDefault();
    const canvas = $('canvas-wrap');
    let newLeft = Math.max(0, Math.min(startLeft + (e.clientX - startX), canvas.clientWidth  - el.offsetWidth));
    let newTop  = Math.max(0, Math.min(startTop  + (e.clientY - startY), canvas.clientHeight - el.offsetHeight));
    el.style.left = newLeft + 'px';
    el.style.top  = newTop  + 'px';
    if (objectType === 'block') highlightNearZones(newLeft, newTop, el.offsetWidth, el.offsetHeight);
  });

  el.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    el.style.zIndex = '';
    const newLeft = parseFloat(el.style.left);
    const newTop  = parseFloat(el.style.top);

    if (objectType === 'block') {
      const snapped = trySnap(objectId, el, newLeft, newTop);
      if (!snapped) {
        // Restore label on zone block just left
        if (blocks[objectId] && blocks[objectId].snappedTo) {
          const prevZEl = document.getElementById(blocks[objectId].snappedTo);
          if (prevZEl) { const lbl = prevZEl.querySelector('.dz-label'); if (lbl) lbl.style.display = 'block'; }
        }
        if (blocks[objectId]) { blocks[objectId].x = newLeft; blocks[objectId].y = newTop; blocks[objectId].snappedTo = null; }
        broadcast({ type: 'move_block', id: objectId, x: newLeft, y: newTop, snappedTo: null });
      }
      clearZoneHighlights();
    } else if (objectType === 'zone') {
      if (dropZones[objectId]) { dropZones[objectId].x = newLeft; dropZones[objectId].y = newTop; }
      broadcast({ type: 'move_zone', id: objectId, x: newLeft, y: newTop });
    }
  });
}

function trySnap(blockId, el, bx, by) {
  const bw = el.offsetWidth, bh = el.offsetHeight;
  const bcx = bx + bw / 2, bcy = by + bh / 2;

  for (const zid in dropZones) {
    const z = dropZones[zid];
    if (!z) continue;
    const zEl = document.getElementById(zid);
    if (!zEl) continue;
    const zw = zEl.offsetWidth, zh = zEl.offsetHeight;
    const dist = Math.hypot(bcx - (z.x + zw/2), bcy - (z.y + zh/2));

    if (dist < SNAP_THRESHOLD) {
      const snapX = z.x + (zw - bw) / 2;
      const snapY = z.y + (zh - bh) / 2;
      el.style.left = snapX + 'px';
      el.style.top  = snapY + 'px';
      el.classList.add('snapped');
      // Hide drop zone label
      const lbl = zEl.querySelector('.dz-label');
      if (lbl) lbl.style.display = 'none';
      if (blocks[blockId]) { blocks[blockId].x = snapX; blocks[blockId].y = snapY; blocks[blockId].snappedTo = zid; }
      broadcast({ type: 'move_block', id: blockId, x: snapX, y: snapY, snappedTo: zid });
      showToast('Snapped! Drag back out to move again.');
      return true;
    }
  }
  el.classList.remove('snapped');
  return false;
}

function highlightNearZones(bx, by, bw, bh) {
  const bcx = bx + bw/2, bcy = by + bh/2;
  for (const zid in dropZones) {
    const z = dropZones[zid];
    if (!z) continue;
    const zEl = document.getElementById(zid);
    if (!zEl) continue;
    const zw = zEl.offsetWidth, zh = zEl.offsetHeight;
    zEl.classList.toggle('highlight', Math.hypot(bcx - (z.x+zw/2), bcy - (z.y+zh/2)) < SNAP_THRESHOLD);
  }
}

function clearZoneHighlights() {
  document.querySelectorAll('.drop-zone').forEach(el => el.classList.remove('highlight'));
}

/* ═══════════════════════════════════════════
   BROADCAST & RECEIVE
═══════════════════════════════════════════ */

function broadcast(payload) {
  if (!channel) return;
  channel.send({ type: 'broadcast', event: 'canvas_update', payload });
}

function handleRemoteUpdate(payload) {
  switch (payload.type) {
    case 'add_block':
      if (!blocks[payload.id]) addBlock(payload.text, payload.color, payload.id, payload.x, payload.y, payload.fmt || {}, payload.html || '');
      break;
    case 'remove_block':
      delete blocks[payload.id];
      document.getElementById(payload.id)?.remove();
      break;
    case 'move_block': {
      const el = document.getElementById(payload.id);
      if (el) { el.style.left = payload.x+'px'; el.style.top = payload.y+'px'; el.classList.toggle('snapped', !!payload.snappedTo); }
      if (blocks[payload.id]) { blocks[payload.id].x = payload.x; blocks[payload.id].y = payload.y; blocks[payload.id].snappedTo = payload.snappedTo; }
      // Sync label visibility
      if (payload.snappedTo) {
        const zEl = document.getElementById(payload.snappedTo);
        if (zEl) { const lbl = zEl.querySelector('.dz-label'); if (lbl) lbl.style.display = 'none'; }
      }
      break;
    }
    case 'add_zone':
      if (!dropZones[payload.id]) addDropZone(payload.id, payload.x, payload.y, payload.locked || false);
      break;
    case 'remove_zone':
      delete dropZones[payload.id];
      document.getElementById(payload.id)?.remove();
      break;
    case 'move_zone': {
      const el = document.getElementById(payload.id);
      if (el) { el.style.left = payload.x+'px'; el.style.top = payload.y+'px'; }
      if (dropZones[payload.id]) { dropZones[payload.id].x = payload.x; dropZones[payload.id].y = payload.y; }
      break;
    }
    case 'lock_zone':
      if (dropZones[payload.id]) { dropZones[payload.id].locked = payload.locked; renderDropZone(dropZones[payload.id]); }
      break;
    case 'clear_all':
      Object.keys(blocks).forEach(id => { document.getElementById(id)?.remove(); delete blocks[id]; });
      Object.keys(dropZones).forEach(id => { document.getElementById(id)?.remove(); delete dropZones[id]; });
      break;
  }
}

/* ═══════════════════════════════════════════
   SAVED LAYOUTS (templates) — stored in Supabase table "layouts"
   Table columns expected: id (uuid, default), name (text), data (jsonb), created_at (timestamptz default now())
═══════════════════════════════════════════ */

function snapshotCanvas() {
  return {
    blocks: Object.values(blocks).filter(b => b),
    dropZones: Object.values(dropZones).filter(z => z),
  };
}

function waitForSupabaseClient(timeoutMs = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    (function check() {
      if (supabaseClient) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(check, 150);
    })();
  });
}

async function saveLayout(name) {
  const ready = await waitForSupabaseClient();
  if (!ready) {
    const reason = typeof SUPABASE_URL === 'undefined'
      ? 'config.js did not load (SUPABASE_URL undefined)'
      : typeof window.supabase === 'undefined'
        ? 'Supabase library script did not load'
        : 'Supabase client never initialised';
    showToast('DB not ready: ' + reason, 7000);
    console.error('[TutorBlocks] saveLayout: client not ready —', reason);
    return;
  }
  const snapshot = snapshotCanvas();
  try {
    const { error } = await supabaseClient
      .from('layouts')
      .insert({ name, data: snapshot });
    if (error) throw error;
    showToast('Layout "' + name + '" saved!');
  } catch (err) {
    console.error('[TutorBlocks] saveLayout error:', err);
    showToast('Save failed: ' + (err.message || JSON.stringify(err)), 7000);
  }
}

async function fetchLayouts() {
  const ready = await waitForSupabaseClient();
  if (!ready) {
    showToast('Database not connected yet — try again', 5000);
    return [];
  }
  try {
    const { data, error } = await supabaseClient
      .from('layouts')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.error('[TutorBlocks] fetchLayouts error:', err);
    return [];
  }
}

async function loadLayoutById(id) {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('layouts')
      .select('data')
      .eq('id', id)
      .single();
    if (error) throw error;

    // Clear current board first
    clearAll();

    // Small delay so clear_all broadcast lands before we add new objects
    setTimeout(() => {
      (data.data.dropZones || []).forEach(z => {
        addDropZone(null, z.x, z.y, z.locked || false);
      });
      (data.data.blocks || []).forEach(b => {
        addBlock(b.text, b.color, null, b.x, b.y);
        // Restore snap relationship after a tick so drop zones exist
      });
      showToast('Layout loaded!');
    }, 150);

  } catch (err) {
    console.error('[TutorBlocks] loadLayoutById error:', err);
    showToast('Could not load layout');
  }
}

async function deleteLayoutById(id) {
  if (!supabaseClient) return;
  try {
    const { error } = await supabaseClient.from('layouts').delete().eq('id', id);
    if (error) throw error;
    showToast('Layout deleted');
  } catch (err) {
    console.error('[TutorBlocks] deleteLayoutById error:', err);
    showToast('Could not delete layout');
  }
}

/* ── Save Layout Modal ── */

function openSaveLayoutModal() {
  const existing = document.getElementById('save-layout-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'save-layout-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#252d3d;border-radius:14px;padding:22px;width:300px;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

  const title = document.createElement('div');
  title.textContent = 'Save Current Layout';
  title.style.cssText = 'font-size:14px;font-weight:800;color:#fff;';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'e.g. Sight Words Game';
  input.maxLength = 40;
  input.style.cssText = 'background:rgba(255,255,255,0.07);border:1.5px solid rgba(255,255,255,0.12);border-radius:8px;color:#fff;font-family:Nunito,sans-serif;font-size:14px;font-weight:600;padding:10px 12px;outline:none;';

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'flex:1;height:38px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);color:#64748b;font-family:Nunito,sans-serif;font-weight:800;cursor:pointer;';
  cancelBtn.addEventListener('click', () => overlay.remove());

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.style.cssText = 'flex:1;height:38px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-family:Nunito,sans-serif;font-weight:800;cursor:pointer;';
  saveBtn.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) { showToast('Please enter a name'); return; }
    overlay.remove();
    await saveLayout(name);
  });

  input.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(saveBtn);
  box.appendChild(title);
  box.appendChild(input);
  box.appendChild(btnRow);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  setTimeout(() => input.focus(), 50);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

/* ── Load Layout Modal ── */

async function openLoadLayoutModal() {
  const existing = document.getElementById('load-layout-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'load-layout-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:1000;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#252d3d;border-radius:14px;padding:22px;width:340px;max-height:70vh;display:flex;flex-direction:column;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

  const title = document.createElement('div');
  title.textContent = 'My Saved Layouts';
  title.style.cssText = 'font-size:14px;font-weight:800;color:#fff;';

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:6px;overflow-y:auto;max-height:300px;';
  list.textContent = 'Loading…';
  list.style.color = '#64748b';
  list.style.fontSize = '13px';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'height:38px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);color:#64748b;font-family:Nunito,sans-serif;font-weight:800;cursor:pointer;';
  closeBtn.addEventListener('click', () => overlay.remove());

  box.appendChild(title);
  box.appendChild(list);
  box.appendChild(closeBtn);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const layouts = await fetchLayouts();
  list.innerHTML = '';

  if (layouts.length === 0) {
    list.textContent = 'No saved layouts yet — use "Save Layout" first.';
    list.style.color = '#64748b';
    list.style.fontSize = '13px';
    return;
  }

  layouts.forEach(layout => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.05);border-radius:8px;padding:8px 10px;';

    const name = document.createElement('div');
    name.textContent = layout.name;
    name.style.cssText = 'flex:1;color:#e2e8f0;font-size:13px;font-weight:700;';

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.style.cssText = 'height:30px;padding:0 12px;border-radius:6px;border:none;background:#3b82f6;color:#fff;font-family:Nunito,sans-serif;font-size:11px;font-weight:800;cursor:pointer;';
    loadBtn.addEventListener('click', async () => {
      const ok = await customConfirm('Load "' + layout.name + '"? This will clear the current board.');
      if (!ok) return;
      overlay.remove();
      await loadLayoutById(layout.id);
    });

    const delBtn = document.createElement('button');
    delBtn.textContent = '×';
    delBtn.style.cssText = 'height:30px;width:30px;border-radius:6px;border:none;background:rgba(239,68,68,0.15);color:#f87171;font-weight:900;cursor:pointer;';
    delBtn.addEventListener('click', async () => {
      const ok = await customConfirm('Delete "' + layout.name + '"?');
      if (!ok) return;
      await deleteLayoutById(layout.id);
      row.remove();
    });

    row.appendChild(name);
    row.appendChild(loadBtn);
    row.appendChild(delBtn);
    list.appendChild(row);
  });
}

/* ═══════════════════════════════════════════
   CUSTOM CONFIRM MODAL (replaces native confirm() which is
   blocked/unreliable inside Zoom's sandboxed iframe)
═══════════════════════════════════════════ */

function customConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:2000;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#252d3d;border-radius:14px;padding:22px;width:300px;display:flex;flex-direction:column;gap:16px;box-shadow:0 8px 32px rgba(0,0,0,0.4);';

    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.cssText = 'color:#fff;font-family:Nunito,sans-serif;font-size:14px;font-weight:700;line-height:1.5;';

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'flex:1;height:38px;border-radius:8px;border:none;background:rgba(255,255,255,0.07);color:#94a3b8;font-family:Nunito,sans-serif;font-weight:800;cursor:pointer;';
    cancelBtn.addEventListener('click', () => { overlay.remove(); resolve(false); });

    const okBtn = document.createElement('button');
    okBtn.textContent = 'Confirm';
    okBtn.style.cssText = 'flex:1;height:38px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-family:Nunito,sans-serif;font-weight:800;cursor:pointer;';
    okBtn.addEventListener('click', () => { overlay.remove(); resolve(true); });

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(msg);
    box.appendChild(btnRow);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => { if (e.target === overlay) { overlay.remove(); resolve(false); } });
  });
}