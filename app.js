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

  // Clear All
  tb.appendChild(makeBtn('Clear All', 'danger', () => {
    if (confirm('Remove all blocks and drop zones?')) clearAll();
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

    const popup = $('block-popup');
    const title = popup.querySelector('.pop-title');
    title.after(tabRow);

    btnLetters.addEventListener('click', () => {
      freeTextMode = false;
      btnLetters.style.background = '#3b82f6'; btnLetters.style.color = '#fff';
      btnFree.style.background = 'rgba(255,255,255,0.07)'; btnFree.style.color = '#94a3b8';
      presetsSection.style.display = 'block';
      freeTextSection.style.display = 'none';
      // Show colour picker
      const cs = $('colour-section'); if (cs) cs.style.display = 'block';
    });

    btnFree.addEventListener('click', () => {
      freeTextMode = true;
      btnFree.style.background = '#3b82f6'; btnFree.style.color = '#fff';
      btnLetters.style.background = 'rgba(255,255,255,0.07)'; btnLetters.style.color = '#94a3b8';
      presetsSection.style.display = 'none';
      freeTextSection.style.display = 'block';
      // Hide colour picker
      const cs = $('colour-section'); if (cs) cs.style.display = 'none';
      setTimeout(() => $('free-text-input').focus(), 50);
    });
  }

  // Letter chips
  const chipLetters = $('chip-letters');
  PRESET_LETTERS.forEach(l => {
    const chip = makeChip(l, () => {
      $('block-input').value = l; popupText = l;
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
      $('block-input').value = w; popupText = w;
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

  $('block-input').addEventListener('input', e => {
    popupText = e.target.value.trim();
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  });

  $('popup-confirm').addEventListener('click', () => confirmAddBlock());
  $('popup-cancel').addEventListener('click', () => togglePopup(false));
  $('block-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddBlock(); });
  $('free-text-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmAddBlock(); } });
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
    setTimeout(() => $('block-input').focus(), 50);
  } else {
    popup.classList.remove('open');
    $('block-input').value = '';
    const fi = $('free-text-input');
    if (fi) fi.value = '';
    popupText = '';
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  }
}

function confirmAddBlock() {
  let text = '';
  if (freeTextMode) {
    text = ($('free-text-input').value || '').trim();
    if (!text) { showToast('Please enter some text'); return; }
    togglePopup(false);
    addBlock(text, 'none'); // 'none' = plain text, no colour block
  } else {
    text = (popupText || $('block-input').value || '').trim().toUpperCase();
    if (!text) { showToast('Please enter some text'); return; }
    togglePopup(false);
    addBlock(text, selectedColor);
  }
}

/* ═══════════════════════════════════════════
   BLOCKS
═══════════════════════════════════════════ */

function addBlock(text, color, id = null, x = null, y = null) {
  const canvas = $('canvas-wrap');
  const blockId = id || 'blk_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  const cx = x ?? (canvas.clientWidth  / 2 - 40 + Math.random() * 80 - 40);
  const cy = y ?? (canvas.clientHeight / 2 - 28 + Math.random() * 80 - 40);
  const data = { id: blockId, text, color, x: cx, y: cy, snappedTo: null };
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
    // Plain text — transparent, resizable, draggable
    el.className = 'text-block text-plain';
    el.style.background = 'transparent';
    el.style.border = '2px dashed rgba(0,0,0,0.18)';
    el.style.boxShadow = 'none';
    el.style.color = '#1a202c';
    el.style.fontSize = '18px';
    el.style.fontWeight = '700';
    el.style.padding = '6px 10px';
    el.style.minWidth = '60px';
    el.style.minHeight = '30px';
    el.style.width = data.w ? data.w + 'px' : 'auto';
    el.style.height = data.h ? data.h + 'px' : 'auto';
    el.style.whiteSpace = 'pre-wrap';
    el.style.maxWidth = '400px';
    el.style.lineHeight = '1.4';
    el.style.overflow = 'hidden';
    el.style.resize = 'both'; // browser native resize handle
  } else {
    el.className = 'text-block';
    el.style.background = data.color;
  }
  el.textContent = data.text;

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
      if (!blocks[payload.id]) addBlock(payload.text, payload.color, payload.id, payload.x, payload.y);
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
