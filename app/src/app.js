// Leonida Cover Co. — offline GTA-style multi-panel cover maker.
// One module: state, the canvas renderer, the editor wiring, and the
// deterministic ?shot= scenes used for screenshots. No network anywhere:
// photos come from the user's files or the bundled samples, fonts are local.
const canvas = document.getElementById('cover');
const statusEl = document.getElementById('status');
const thumbsEl = document.getElementById('thumbs');

const SIZES = {
  '1080x1080': [1080, 1080],
  '1080x1350': [1080, 1350],
  '1920x1080': [1920, 1080],
};
const GRADES = {
  sunset: { filter: 'saturate(1.35) contrast(1.08) brightness(1.03)', tint: ['rgba(255,122,24,0.10)', 'rgba(255,46,136,0.16)'] },
  neon: { filter: 'saturate(1.9) contrast(1.18) brightness(1.02)', tint: ['rgba(255,0,200,0.16)', 'rgba(0,229,255,0.14)'] },
  noir: { filter: 'grayscale(1) contrast(1.32) brightness(1.06)', tint: ['rgba(0,0,0,0)', 'rgba(0,0,0,0)'] },
  vice: { filter: 'saturate(1.45) contrast(1.1) sepia(0.18) hue-rotate(8deg)', tint: ['rgba(0,200,190,0.10)', 'rgba(255,122,24,0.12)'] },
};

const state = {
  layout: 'quad',
  grade: 'sunset',
  grain: true,
  vignette: true,
  title: 'Sunset Heist',
  subtitle: 'a Leonida story',
  size: '1080x1080',
  selected: 0,
  photos: [], // { name, img, url }
  panels: Array.from({ length: 9 }, () => ({ photo: -1, zoom: 1, panX: 0, panY: 0, rot: 0 })),
};
let lastRects = [];
let shotMode = null;

// ---------- deterministic grain tile (seeded, so every render matches) ----------
let grainTile = null;
function makeGrainTile() {
  if (grainTile) return grainTile;
  const t = document.createElement('canvas');
  t.width = 160; t.height = 160;
  const c = t.getContext('2d');
  const img = c.createImageData(160, 160);
  let seed = 20261120;
  const next = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(next() * 255);
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 22;
  }
  c.putImageData(img, 0, 0);
  grainTile = t;
  return t;
}

// ---------- layout geometry ----------
function visibleCount() {
  return state.layout === 'nine' ? 9 : state.layout === 'full' ? 1 : 4;
}
function panelRects(layout, W, H) {
  const margin = Math.round(W * 0.028);
  const gut = Math.max(5, Math.round(W * 0.011));
  if (layout === 'full') return [{ x: 0, y: 0, w: W, h: H }];
  const top = Math.round(H * 0.205);
  const area = { x: margin, y: top, w: W - margin * 2, h: Math.round(H * 0.965) - top };
  const grid = (cols, rows) => {
    const out = [];
    const cw = (area.w - gut * (cols - 1)) / cols;
    const ch = (area.h - gut * (rows - 1)) / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.push({ x: area.x + c * (cw + gut), y: area.y + r * (ch + gut), w: cw, h: ch });
      }
    }
    return out;
  };
  if (layout === 'quad') return grid(2, 2);
  if (layout === 'nine') return grid(3, 3);
  // hero: big panel left, three stacked on the right
  const leftW = area.w * 0.62;
  const rightX = area.x + leftW + gut;
  const rightW = area.w - leftW - gut;
  const rh = (area.h - gut * 2) / 3;
  return [
    { x: area.x, y: area.y, w: leftW, h: area.h },
    { x: rightX, y: area.y, w: rightW, h: rh },
    { x: rightX, y: area.y + rh + gut, w: rightW, h: rh },
    { x: rightX, y: area.y + (rh + gut) * 2, w: rightW, h: rh },
  ];
}

// ---------- the cover renderer (preview and export share it) ----------
function drawPhotoInto(ctx, rect, img, panel) {
  const scale = Math.max(rect.w / img.naturalWidth, rect.h / img.naturalHeight) * panel.zoom;
  const pw = img.naturalWidth * scale;
  const ph = img.naturalHeight * scale;
  // Never pan so far that the photo stops covering its panel: clamp the
  // offset to the photo's actual overhang on each axis.
  const maxPanX = Math.max(0, (pw - rect.w) / 2 / rect.w);
  const maxPanY = Math.max(0, (ph - rect.h) / 2 / rect.h);
  const panX = Math.max(-maxPanX, Math.min(maxPanX, panel.panX));
  const panY = Math.max(-maxPanY, Math.min(maxPanY, panel.panY));
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(rect.x + rect.w / 2 + panX * rect.w, rect.y + rect.h / 2 + panY * rect.h);
  ctx.rotate((panel.rot * Math.PI) / 180);
  ctx.filter = GRADES[state.grade].filter;
  ctx.drawImage(img, -pw / 2, -ph / 2, pw, ph);
  ctx.restore();
}

function drawPanelPlaceholder(ctx, rect, n) {
  const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
  g.addColorStop(0, '#4a1a6e');
  g.addColorStop(1, '#c22a7a');
  ctx.fillStyle = g;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.font = `${Math.round(rect.h * 0.28)}px Anton, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n + 1), rect.x + rect.w / 2, rect.y + rect.h / 2);
  ctx.textBaseline = 'alphabetic';
}

export function renderCover(ctx, W, H, opts = {}) {
  const preview = !!opts.preview;
  // Vice City sunset sky: deep purple up top melting into magenta and orange.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2a1052');
  sky.addColorStop(0.35, '#7b1e6e');
  sky.addColorStop(0.62, '#e84393');
  sky.addColorStop(0.85, '#ff7a18');
  sky.addColorStop(1, '#ffb347');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  const rects = panelRects(state.layout, W, H);
  if (preview) lastRects = rects;
  const count = visibleCount();
  const gut = Math.max(5, Math.round(W * 0.011));
  for (let i = 0; i < count; i++) {
    const rect = rects[i];
    const panel = state.panels[i];
    // white comic frame around the panel
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x - gut / 2, rect.y - gut / 2, rect.w + gut, rect.h + gut);
    const photo = panel.photo >= 0 ? state.photos[panel.photo] : null;
    if (photo && photo.img) drawPhotoInto(ctx, rect, photo.img, panel);
    else drawPanelPlaceholder(ctx, rect, i);
  }

  // grade tint washed over the panels
  const tint = GRADES[state.grade].tint;
  const wash = ctx.createLinearGradient(0, 0, W, H);
  wash.addColorStop(0, tint[0]);
  wash.addColorStop(1, tint[1]);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  // Title: huge condensed Anton, sunset gradient fill, black outline, tilted -2deg.
  const words = (state.title || 'LEONIDA').trim().toUpperCase();
  ctx.save();
  ctx.translate(W / 2, H * 0.115);
  ctx.rotate((-2 * Math.PI) / 180);
  let size = Math.round(H * 0.115);
  ctx.font = `${size}px Anton, sans-serif`;
  while (ctx.measureText(words).width > W * 0.94 && size > 14) {
    size -= 2;
    ctx.font = `${size}px Anton, sans-serif`;
  }
  const grad = ctx.createLinearGradient(-W / 2, 0, W / 2, 0);
  grad.addColorStop(0, '#fff7ae');
  grad.addColorStop(0.45, '#ffb347');
  grad.addColorStop(0.75, '#ff5e8a');
  grad.addColorStop(1, '#ff2e88');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeStyle = '#14060f';
  ctx.strokeText(words, 0, 0);
  ctx.fillStyle = grad;
  ctx.fillText(words, 0, 0);
  ctx.restore();

  // Subtitle: neon-pink Yellowtail script under the title.
  const sub = (state.subtitle || '').trim();
  if (sub) {
    ctx.save();
    ctx.font = `${Math.round(H * 0.052)}px Yellowtail, cursive`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff2e88';
    ctx.shadowBlur = Math.round(H * 0.02);
    ctx.fillStyle = '#ff8ac2';
    ctx.fillText(sub, W / 2, H * 0.178);
    ctx.restore();
  }

  // Bottom-right tag.
  const tag = 'LEONIDA · No. 06';
  const tagSize = Math.max(11, Math.round(H * 0.016));
  ctx.font = `700 ${tagSize}px system-ui, sans-serif`;
  const tw = ctx.measureText(tag).width;
  const pad = tagSize * 0.7;
  const bx = W - tw - pad * 2 - Math.round(W * 0.02);
  const by = H - tagSize - pad * 2 - Math.round(H * 0.012);
  ctx.fillStyle = 'rgba(10,4,18,0.78)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(bx, by, tw + pad * 2, tagSize + pad * 2, tagSize);
  else ctx.rect(bx, by, tw + pad * 2, tagSize + pad * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag, bx + pad, by + (tagSize + pad * 2) / 2);

  if (state.grain) {
    const tile = makeGrainTile();
    const pat = ctx.createPattern(tile, 'repeat');
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }
  if (state.vignette) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, 'rgba(10,0,20,0)');
    v.addColorStop(1, 'rgba(10,0,20,0.45)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // Selected-panel outline, preview only — never in an export.
  if (preview && state.selected < count) {
    const r = rects[state.selected];
    ctx.save();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.setLineDash([Math.max(8, W * 0.014), Math.max(6, W * 0.01)]);
    ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
    ctx.restore();
  }
}

function redraw() {
  const ctx = canvas.getContext('2d');
  // A cover screenshot is the finished poster: no editor selection outline.
  renderCover(ctx, canvas.width, canvas.height, { preview: shotMode !== 'cover' });
}

// ---------- photos ----------
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
async function addPhoto(name, url) {
  const found = state.photos.find((p) => p.name === name);
  if (found) return found;
  const img = await loadImage(url);
  const photo = { name, img, url };
  state.photos.push(photo);
  refreshThumbs();
  return photo;
}
async function addSample(name) {
  const photo = await addPhoto(name, `./samples/${name}.jpg`);
  const idx = state.photos.indexOf(photo);
  const empty = state.panels.findIndex((p, i) => i < visibleCount() && p.photo < 0);
  const target = empty >= 0 ? empty : state.selected;
  state.panels[target].photo = idx;
  state.selected = target;
  syncPanelControls();
  redraw();
}
function refreshThumbs() {
  thumbsEl.innerHTML = '';
  state.photos.forEach((photo, idx) => {
    const el = document.createElement('img');
    el.src = photo.url;
    el.alt = photo.name;
    el.title = photo.name;
    if (state.panels[state.selected].photo === idx) el.classList.add('assigned');
    el.addEventListener('click', () => {
      state.panels[state.selected].photo = idx;
      state.panels[state.selected].zoom = 1;
      state.panels[state.selected].panX = 0;
      state.panels[state.selected].panY = 0;
      syncPanelControls();
      refreshThumbs();
      redraw();
    });
    thumbsEl.appendChild(el);
  });
}

// ---------- editor wiring ----------
function markActive(container, attr, value) {
  container.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset[attr] === value);
  });
}
function syncPanelControls() {
  const p = state.panels[state.selected];
  document.getElementById('panelLabel').textContent = `#${state.selected + 1}`;
  document.getElementById('zoom').value = p.zoom;
  document.getElementById('rotate').value = p.rot;
  document.getElementById('zoomVal').textContent = `${p.zoom.toFixed(2)}×`;
  document.getElementById('rotVal').textContent = `${p.rot}°`;
  refreshThumbs();
}
function setPreviewSize() {
  const [w, h] = SIZES[state.size];
  const scale = Math.min(900 / w, 900 / h);
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
}

document.getElementById('layouts').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-layout]');
  if (!b) return;
  state.layout = b.dataset.layout;
  if (state.selected >= visibleCount()) state.selected = 0;
  markActive(document.getElementById('layouts'), 'layout', state.layout);
  syncPanelControls();
  redraw();
});
document.getElementById('grades').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-grade]');
  if (!b) return;
  state.grade = b.dataset.grade;
  markActive(document.getElementById('grades'), 'grade', state.grade);
  redraw();
});
document.getElementById('sizes').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-size]');
  if (!b) return;
  state.size = b.dataset.size;
  markActive(document.getElementById('sizes'), 'size', state.size);
  setPreviewSize();
  redraw();
});
document.getElementById('grain').addEventListener('change', (e) => { state.grain = e.target.checked; redraw(); });
document.getElementById('vignette').addEventListener('change', (e) => { state.vignette = e.target.checked; redraw(); });
document.getElementById('title').addEventListener('input', (e) => { state.title = e.target.value; redraw(); });
document.getElementById('subtitle').addEventListener('input', (e) => { state.subtitle = e.target.value; redraw(); });
document.getElementById('zoom').addEventListener('input', (e) => {
  state.panels[state.selected].zoom = Number(e.target.value);
  document.getElementById('zoomVal').textContent = `${state.panels[state.selected].zoom.toFixed(2)}×`;
  redraw();
});
document.getElementById('rotate').addEventListener('input', (e) => {
  state.panels[state.selected].rot = Number(e.target.value);
  document.getElementById('rotVal').textContent = `${state.panels[state.selected].rot}°`;
  redraw();
});
document.getElementById('fillAll').addEventListener('click', () => {
  const src = state.panels[state.selected];
  if (src.photo < 0) { statusEl.textContent = 'Pick a photo for this panel first.'; return; }
  for (let i = 0; i < visibleCount(); i++) {
    state.panels[i].photo = src.photo;
    state.panels[i].zoom = src.zoom;
    // a different crop per panel, so one photo reads as several shots
    state.panels[i].panX = ((i % 3) - 1) * 0.14;
    state.panels[i].panY = ((Math.floor(i / 3) % 3) - 1) * 0.1;
  }
  statusEl.textContent = 'One photo now fills every panel, each cropped differently.';
  redraw();
});
document.getElementById('upload').addEventListener('change', async (e) => {
  for (const file of e.target.files) {
    const url = URL.createObjectURL(file);
    const photo = await addPhoto(file.name, url);
    const idx = state.photos.indexOf(photo);
    state.panels[state.selected].photo = idx;
  }
  syncPanelControls();
  redraw();
});
document.getElementById('samplePier').addEventListener('click', () => addSample('pier'));
document.getElementById('sampleBoulevard').addEventListener('click', () => addSample('boulevard'));

document.getElementById('export').addEventListener('click', () => {
  const [w, h] = SIZES[state.size];
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  renderCover(off.getContext('2d'), w, h, {});
  off.toBlob((blob) => {
    if (!blob) { statusEl.textContent = 'Export failed.'; return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `leonida-cover-${w}x${h}.png`;
    a.click();
    statusEl.textContent = `Saved leonida-cover-${w}x${h}.png`;
  }, 'image/png');
});

// Click a panel to select it; drag it to pan.
let drag = null;
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
}
canvas.addEventListener('pointerdown', (e) => {
  const pt = canvasPoint(e);
  const hit = lastRects.findIndex((r) => pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h);
  if (hit < 0 || hit >= visibleCount()) return;
  state.selected = hit;
  syncPanelControls();
  drag = { x: pt.x, y: pt.y, panX: state.panels[hit].panX, panY: state.panels[hit].panY, rect: lastRects[hit] };
  canvas.setPointerCapture(e.pointerId);
  redraw();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const pt = canvasPoint(e);
  const p = state.panels[state.selected];
  p.panX = Math.max(-0.45, Math.min(0.45, drag.panX + (pt.x - drag.x) / drag.rect.w));
  p.panY = Math.max(-0.45, Math.min(0.45, drag.panY + (pt.y - drag.y) / drag.rect.h));
  redraw();
});
canvas.addEventListener('pointerup', () => { drag = null; });

// ---------- deterministic screenshot scenes ----------
async function runShot() {
  const q = new URLSearchParams(location.search);
  shotMode = q.get('shot');
  if (!shotMode) return false;
  if (q.get('layout')) state.layout = q.get('layout');
  if (q.get('grade')) state.grade = q.get('grade');
  if (q.get('caption')) { state.title = q.get('caption'); document.getElementById('title').value = state.title; }
  if (q.get('subtitle')) { state.subtitle = q.get('subtitle'); document.getElementById('subtitle').value = state.subtitle; }
  if (q.get('size') && SIZES[q.get('size')]) state.size = q.get('size');
  const photoName = q.get('photo') ?? 'pier';
  await document.fonts.load('40px Anton');
  await document.fonts.load('40px Yellowtail');
  await document.fonts.ready;
  await addSample(photoName);
  // Fill every remaining panel so a screenshot always shows the full
  // multi-panel cover, not placeholders: cover shots alternate the two
  // samples, editor shots repeat the loaded photo with different crops.
  if (shotMode === 'cover') {
    const other = photoName === 'pier' ? 'boulevard' : 'pier';
    const extra = await addPhoto(other, `./samples/${other}.jpg`);
    const extraIdx = state.photos.indexOf(extra);
    for (let i = 0; i < visibleCount(); i++) {
      if (state.panels[i].photo < 0) {
        state.panels[i].photo = i % 2 === 0 ? state.panels[0].photo : extraIdx;
        state.panels[i].panX = ((i % 3) - 1) * 0.14;
        state.panels[i].panY = ((Math.floor(i / 3) % 3) - 1) * 0.1;
      }
    }
  } else {
    for (let i = 0; i < visibleCount(); i++) {
      if (state.panels[i].photo < 0) {
        state.panels[i].photo = state.panels[0].photo;
        state.panels[i].panX = ((i % 3) - 1) * 0.12;
        state.panels[i].panY = ((Math.floor(i / 3) % 3) - 1) * 0.08;
      }
    }
  }
  markActive(document.getElementById('layouts'), 'layout', state.layout);
  markActive(document.getElementById('grades'), 'grade', state.grade);
  markActive(document.getElementById('sizes'), 'size', state.size);
  if (shotMode === 'cover') {
    document.body.classList.add('shot-cover');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  } else {
    setPreviewSize();
  }
  syncPanelControls();
  redraw();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  window.__shotReady = true;
  return true;
}

markActive(document.getElementById('layouts'), 'layout', state.layout);
markActive(document.getElementById('grades'), 'grade', state.grade);
markActive(document.getElementById('sizes'), 'size', state.size);
setPreviewSize();
if (!await runShot()) {
  document.fonts.ready.then(redraw);
  redraw();
}
