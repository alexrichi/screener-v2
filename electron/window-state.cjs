const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;
/** A restored window must leave at least this much of itself on one display. */
const MIN_VISIBLE = 80;

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Read a saved geometry; a malformed or undersized file is ignored. */
function readWindowState(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    const { x, y, width, height, maximized } = parsed;
    if (!isNumber(x) || !isNumber(y) || !isNumber(width) || !isNumber(height)) return null;
    if (width < MIN_WIDTH || height < MIN_HEIGHT) return null;
    return {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(width),
      height: Math.round(height),
      maximized: maximized === true,
    };
  } catch {
    return null;
  }
}

/** A display's usable rectangle, or null when the record is incomplete. */
function workAreaOf(display) {
  const area = display && (display.workArea ?? display.bounds);
  if (
    !area ||
    !isNumber(area.x) ||
    !isNumber(area.y) ||
    !isNumber(area.width) ||
    !isNumber(area.height) ||
    area.width <= 0 ||
    area.height <= 0
  ) {
    return null;
  }
  return area;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** The default size, clamped to the first display when it is smaller. */
function defaultBounds(displays, maximized) {
  const area = (displays ?? []).map(workAreaOf).find(Boolean) ?? null;
  return {
    width: area ? Math.max(1, Math.min(DEFAULT_WIDTH, Math.round(area.width))) : DEFAULT_WIDTH,
    height: area ? Math.max(1, Math.min(DEFAULT_HEIGHT, Math.round(area.height))) : DEFAULT_HEIGHT,
    maximized: maximized === true,
  };
}

/** Keep a saved geometry only when it still lands on a connected display. */
function fitBounds(state, displays) {
  if (!state) return defaultBounds(displays, false);

  const maximized = state.maximized === true;
  const saved = {
    x: Math.round(state.x),
    y: Math.round(state.y),
    width: Math.max(MIN_WIDTH, Math.round(state.width)),
    height: Math.max(MIN_HEIGHT, Math.round(state.height)),
  };

  // The display holding most of the saved window owns its clamped bounds.
  let area = null;
  let overlap = 0;
  for (const display of displays ?? []) {
    const work = workAreaOf(display);
    if (!work) continue;
    const width =
      Math.min(saved.x + saved.width, work.x + work.width) - Math.max(saved.x, work.x);
    const height =
      Math.min(saved.y + saved.height, work.y + work.height) - Math.max(saved.y, work.y);
    if (width <= 0 || height <= 0) continue;
    if (width * height > overlap) {
      overlap = width * height;
      area = work;
    }
  }
  if (!area) {
    return defaultBounds(displays, maximized);
  }

  const width = Math.max(1, Math.min(saved.width, Math.round(area.width)));
  const height = Math.max(1, Math.min(saved.height, Math.round(area.height)));
  return {
    x: Math.round(clamp(saved.x, area.x - width + MIN_VISIBLE, area.x + area.width - MIN_VISIBLE)),
    y: Math.round(clamp(saved.y, area.y, area.y + area.height - MIN_VISIBLE)),
    width,
    height,
    maximized,
  };
}

/** The geometry to persist: the normal bounds while maximized, else the live ones. */
function captureWindowState(win) {
  try {
    const maximized = win.isMaximized();
    const bounds = maximized ? win.getNormalBounds() : win.getBounds();
    return { ...bounds, maximized };
  } catch {
    return null;
  }
}

function saveWindowState(file, state) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
  } catch {
    /* window geometry is a convenience; never fail a close over it */
  }
}

module.exports = {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  captureWindowState,
  fitBounds,
  readWindowState,
  saveWindowState,
};
