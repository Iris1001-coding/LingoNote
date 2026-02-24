/**
 * LingoNote Content Script
 * Handles selection, rendering, and storage.
 */

// --- Configuration ---
const COLORS = {
  red: { hex: '#FF5252', label: 'Missed', hl: 'rgba(255, 82, 82, 0.2)' },
  blue: { hex: '#448AFF', label: 'Synonym', hl: 'rgba(68, 138, 255, 0.2)' },
  green: { hex: '#69F0AE', label: 'Key Point', hl: 'rgba(105, 240, 174, 0.2)' },
  yellow: { hex: '#FFD740', label: 'General', hl: 'rgba(255, 215, 64, 0.2)' },
  purple: { hex: '#E040FB', label: 'Grammar', hl: 'rgba(224, 64, 251, 0.2)' },
  orange: { hex: '#FFAB40', label: 'Vocab', hl: 'rgba(255, 171, 64, 0.2)' }
};

const STORAGE_KEY = 'lingonotes';
const UI_CONFIG_KEY = 'lingonote_ui_config';
const DEFAULT_COLOR_LABELS = Object.fromEntries(
  Object.entries(COLORS).map(([key, val]) => [key, val.label])
);

// --- State ---
let shadowHost = null;
let shadowRoot = null;
let activeSelection = null;
let notes = [];
let toolbar = null;
let legend = null;
let isLegendCollapsed = false;
let legendTitle = 'LingoNote';
let isExtensionEnabled = true;
let messageListenerRegistered = false;

function normalizeUrl(url = window.location.href) {
  try {
    const parsed = new URL(url || window.location.href, window.location.href);
    return `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    return (url || window.location.href).split('#')[0].split('?')[0];
  }
}

function getCurrentPageKey() {
  return normalizeUrl(window.location.href);
}

function sanitizeLabelText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function applyLabelChangesToUI() {
  if (toolbar) {
    toolbar.querySelectorAll('.ln-color-btn').forEach((btn) => {
      const color = btn.dataset.color;
      if (color && COLORS[color]) {
        btn.setAttribute('title', COLORS[color].label);
      }
    });
  }

  if (legend) {
    const titleEl = legend.querySelector('.ln-legend-title');
    if (titleEl) titleEl.innerText = legendTitle;
  }

  if (!shadowRoot) return;

  shadowRoot.querySelectorAll('.ln-note-card').forEach((card) => {
    const color = card.dataset.color;
    const labelEl = card.querySelector('.ln-note-type-label');
    if (color && labelEl && COLORS[color]) {
      labelEl.innerText = COLORS[color].label;
    }
  });

  shadowRoot.querySelectorAll('.ln-bubble').forEach((bubble) => {
    const noteId = bubble.dataset.id;
    const previewEl = bubble.querySelector('.ln-bubble-preview');
    if (!noteId || !previewEl) return;
    const note = notes.find((item) => item.id === noteId);
    if (note && !note.text && COLORS[note.color]) {
      previewEl.innerText = COLORS[note.color].label;
    }
  });
}

function saveUiConfig() {
  const colorLabels = {};
  Object.keys(COLORS).forEach((key) => {
    colorLabels[key] = COLORS[key].label;
  });

  chrome.storage.local.set({
    [UI_CONFIG_KEY]: {
      legendTitle,
      colorLabels,
    },
  });
}

function loadUiConfig() {
  chrome.storage.local.get([UI_CONFIG_KEY], (result) => {
    const config = result[UI_CONFIG_KEY];
    if (!config || typeof config !== 'object') return;

    const nextTitle = sanitizeLabelText(config.legendTitle);
    if (nextTitle) legendTitle = nextTitle;

    const savedLabels = config.colorLabels;
    if (savedLabels && typeof savedLabels === 'object') {
      Object.keys(COLORS).forEach((key) => {
        const custom = sanitizeLabelText(savedLabels[key]);
        COLORS[key].label = custom || DEFAULT_COLOR_LABELS[key];
      });
    }

    applyLabelChangesToUI();
    updateLegend();
    applyLabelChangesToUI();
  });
}

// --- Initialization ---
function init() {
  if (document.body.classList.contains('ln-demo-page')) return;

  setupShadowDOM();
  loadUiConfig();
  setupSelectionListener();
  setupMessageListener();

  // Delay loading to improve match rate on pages that render text late.
  setTimeout(loadNotes, 500);

  window.addEventListener('resize', debounce(repositionElements, 100));

  document.addEventListener('mousedown', (e) => {
    if (!isExtensionEnabled) return;
    if (shadowHost && !shadowHost.contains(e.target)) {
      hideAllCards();
    }
  });

  // Best-effort flush so note text is not lost when leaving page quickly.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      syncTextFromCards();
      saveNotes();
    }
  });

  window.addEventListener('beforeunload', () => {
    syncTextFromCards();
    saveNotes();
  });
}

function setupShadowDOM() {
  shadowHost = document.createElement('div');
  shadowHost.id = 'lingonote-host';
  document.body.appendChild(shadowHost);

  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadowRoot.appendChild(styleLink);

  createToolbar();
  createLegend();
}

function createToolbar() {
  if (toolbar) return;

  toolbar = document.createElement('div');
  toolbar.className = 'ln-toolbar';

  let buttonsHtml = '';
  Object.entries(COLORS).forEach(([key, val]) => {
    buttonsHtml += `<div class="ln-color-btn ln-c-${key}" data-color="${key}" title="${val.label}"></div>`;
  });

  toolbar.innerHTML = buttonsHtml;
  shadowRoot.appendChild(toolbar);

  toolbar.querySelectorAll('.ln-color-btn').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      createNote(btn.dataset.color);
    });
  });
}

function createLegend() {
  legend = document.createElement('div');
  legend.className = 'ln-legend';
  legend.innerHTML = `
    <div class="ln-legend-header">
      <div class="ln-legend-title" contenteditable="true">${legendTitle}</div>
      <div class="ln-legend-toggle" title="Minimize">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
      </div>
    </div>
    <div class="ln-legend-list"></div>
    <div class="ln-legend-icon" title="Open">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
    </div>
  `;

  shadowRoot.appendChild(legend);
  updateLegend();
  makeDraggable(legend);

  const toggleBtn = legend.querySelector('.ln-legend-toggle');
  const iconBtn = legend.querySelector('.ln-legend-icon');
  const titleEl = legend.querySelector('.ln-legend-title');
  const toggleLegend = (e) => {
    e.stopPropagation();
    isLegendCollapsed = !isLegendCollapsed;
    isLegendCollapsed ? legend.classList.add('collapsed') : legend.classList.remove('collapsed');
  };

  toggleBtn.addEventListener('click', toggleLegend);
  iconBtn.addEventListener('click', toggleLegend);

  titleEl.addEventListener('blur', () => {
    const nextTitle = sanitizeLabelText(titleEl.innerText);
    legendTitle = nextTitle || 'LingoNote';
    titleEl.innerText = legendTitle;
    saveUiConfig();
  });
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleEl.blur();
    }
  });
}

function updateLegend() {
  if (!legend) return;

  const list = legend.querySelector('.ln-legend-list');
  let html = '';

  Object.entries(COLORS).forEach(([key, val]) => {
    html += `
      <div class="ln-legend-item">
        <div class="ln-legend-dot ln-c-${key}"></div>
        <div class="ln-legend-label" contenteditable="true" data-color="${key}">${val.label}</div>
      </div>`;
  });

  list.innerHTML = html;
  list.querySelectorAll('.ln-legend-label').forEach((labelEl) => {
    labelEl.addEventListener('blur', () => {
      const color = labelEl.dataset.color;
      if (!color || !COLORS[color]) return;
      const custom = sanitizeLabelText(labelEl.innerText);
      COLORS[color].label = custom || DEFAULT_COLOR_LABELS[color];
      labelEl.innerText = COLORS[color].label;
      applyLabelChangesToUI();
      saveUiConfig();
    });
    labelEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        labelEl.blur();
      }
    });
  });
}

function makeDraggable(element) {
  let pos1 = 0;
  let pos2 = 0;
  let pos3 = 0;
  let pos4 = 0;

  const header = element.querySelector('.ln-legend-header');
  const icon = element.querySelector('.ln-legend-icon');
  const startDrag = (e) => {
    if (e.target.isContentEditable) return;

    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;

    document.onmouseup = () => {
      document.onmouseup = null;
      document.onmousemove = null;
    };

    document.onmousemove = (event) => {
      event.preventDefault();
      pos1 = pos3 - event.clientX;
      pos2 = pos4 - event.clientY;
      pos3 = event.clientX;
      pos4 = event.clientY;
      element.style.top = `${element.offsetTop - pos2}px`;
      element.style.left = `${element.offsetLeft - pos1}px`;
    };
  };

  if (header) header.onmousedown = startDrag;
  if (icon) icon.onmousedown = startDrag;
}

// --- Selection Handling ---
function setupSelectionListener() {
  document.addEventListener('mouseup', (e) => {
    if (!isExtensionEnabled) return;
    if (e.target.closest('.ln-demo-container')) return;

    setTimeout(() => {
      const selection = window.getSelection();
      if (selection.isCollapsed || shadowHost.contains(e.target)) {
        hideToolbar();
        return;
      }

      const text = selection.toString().trim();
      if (text.length > 0) {
        activeSelection = selection.getRangeAt(0);
        showToolbar(activeSelection);
      } else {
        hideToolbar();
      }
    }, 10);
  });
}

function showToolbar(range) {
  const rect = range.getBoundingClientRect();
  const top = rect.top + window.scrollY - 40;
  const left = rect.left + (rect.width / 2) + window.scrollX - 80;
  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.classList.add('visible');
}

function hideToolbar() {
  if (toolbar) toolbar.classList.remove('visible');
  activeSelection = null;
}

// --- Note Creation & DOM Injection ---
function applyHighlightToRange(range, id, color) {
  const span = document.createElement('span');
  span.style.backgroundColor = COLORS[color].hl;
  span.style.borderBottom = `2px solid ${COLORS[color].hex}`;
  span.style.cursor = 'pointer';
  span.className = 'ln-highlight-span';
  span.dataset.id = id;

  try {
    range.surroundContents(span);
  } catch (error) {
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }
}

function getRangeAnchorRect(range) {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return range.getBoundingClientRect();
}

function getHighlightAnchorRectById(id) {
  const spans = document.querySelectorAll(`.ln-highlight-span[data-id="${id}"]`);
  for (let i = 0; i < spans.length; i += 1) {
    const rect = spans[i].getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
  }
  return null;
}

function updateNoteAnchorFromHighlight(note) {
  if (!note?.id || !note?.anchor) return false;
  const rect = getHighlightAnchorRectById(note.id);
  if (!rect) return false;

  note.anchor.scrollTop = rect.top + window.scrollY;
  note.anchor.scrollLeft = rect.left + (rect.width / 2) + window.scrollX;
  return true;
}

function positionNoteUI(note) {
  const bubble = shadowRoot?.querySelector(`.ln-bubble[data-id="${note.id}"]`);
  const card = shadowRoot?.querySelector(`.ln-note-card[data-id="${note.id}"]`);
  if (!bubble || !card) return;

  bubble.style.top = `${note.anchor.scrollTop - 10}px`;
  bubble.style.left = `${note.anchor.scrollLeft - 10}px`;
  card.style.top = `${note.anchor.scrollTop + 20}px`;
  card.style.left = `${note.anchor.scrollLeft}px`;
}

function createNote(color) {
  if (!isExtensionEnabled) return;
  if (!activeSelection) return;

  const range = activeSelection;
  const text = range.toString().trim();
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);

  const rect = getRangeAnchorRect(range);
  if (rect.width === 0 && rect.height === 0) return;

  const scrollTop = rect.top + window.scrollY;
  const scrollLeft = rect.left + (rect.width / 2) + window.scrollX;

  applyHighlightToRange(range, id, color);

  const anchor = {
    text,
    scrollTop,
    scrollLeft,
    url: getCurrentPageKey(),
  };

  const note = { id, color, text: '', anchor, createdAt: Date.now() };

  // Prefer exact highlight geometry over raw selection bounds.
  updateNoteAnchorFromHighlight(note);

  notes.push(note);
  saveNotes();
  renderNote(note, true);

  window.getSelection().removeAllRanges();
  hideToolbar();
}

// --- Rendering ---
function renderNote(note, autoShow = false) {
  const noteUrl = note?.anchor?.url;
  if (noteUrl && normalizeUrl(noteUrl) !== getCurrentPageKey()) return;

  updateNoteAnchorFromHighlight(note);

  const bubble = document.createElement('div');
  bubble.className = `ln-bubble ln-c-${note.color}`;
  bubble.dataset.id = note.id;
  bubble.style.top = `${note.anchor.scrollTop - 10}px`;
  bubble.style.left = `${note.anchor.scrollLeft - 10}px`;

  const preview = document.createElement('div');
  preview.className = 'ln-bubble-preview';
  preview.innerText = note.text ? note.text : COLORS[note.color].label;
  bubble.appendChild(preview);

  const card = document.createElement('div');
  card.className = 'ln-note-card';
  card.dataset.id = note.id;
  card.dataset.color = note.color;

  const savedText = note.text || '';
  card.innerHTML = `
    <div class="ln-note-header">
      <div class="ln-note-type">
        <div class="ln-note-dot ln-bubble ln-c-${note.color}" style="position:static; transform:none;"></div>
        <span class="ln-note-type-label">${COLORS[note.color].label}</span>
      </div>
      <div class="ln-actions">
        <button class="ln-icon-btn minimize" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
        </button>
        <button class="ln-icon-btn delete" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
    <textarea class="ln-note-content" placeholder="Add a note...">${savedText}</textarea>
    <div class="ln-highlight-text">"${note.anchor.text}"</div>
  `;

  card.style.top = `${note.anchor.scrollTop + 20}px`;
  card.style.left = `${note.anchor.scrollLeft}px`;

  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCard(card);
  });

  card.addEventListener('click', (e) => e.stopPropagation());

  card.querySelector('.minimize').addEventListener('click', (e) => {
    e.stopPropagation();
    card.classList.remove('visible');
  });

  const textarea = card.querySelector('textarea');
  textarea.addEventListener('input', debounce((e) => {
    note.text = e.target.value;
    preview.innerText = note.text || COLORS[note.color].label;
    saveNotes();
  }, 200));
  textarea.addEventListener('blur', (e) => {
    note.text = e.target.value;
    preview.innerText = note.text || COLORS[note.color].label;
    saveNotes();
  });

  card.querySelector('.delete').addEventListener('click', () => {
    deleteNote(note.id);
  });

  shadowRoot.appendChild(bubble);
  shadowRoot.appendChild(card);

  if (autoShow) {
    setTimeout(() => {
      hideAllCards();
      card.classList.add('visible');
    }, 10);
  }

  positionNoteUI(note);
}

function toggleCard(card) {
  const isCurrentlyVisible = card.classList.contains('visible');
  hideAllCards();
  if (!isCurrentlyVisible) {
    card.classList.add('visible');
  }
}

function hideAllCards() {
  if (!shadowRoot) return;

  shadowRoot.querySelectorAll('.ln-note-card.visible').forEach((c) => {
    c.classList.remove('visible');
  });
}

function removeHighlightById(id) {
  const spans = document.querySelectorAll(`.ln-highlight-span[data-id="${id}"]`);
  spans.forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;

    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }

    parent.removeChild(span);
    parent.normalize();
  });
}

function setHighlightVisibleById(id, color, visible) {
  const spans = document.querySelectorAll(`.ln-highlight-span[data-id="${id}"]`);
  spans.forEach((span) => {
    if (visible) {
      span.style.backgroundColor = COLORS[color].hl;
      span.style.borderBottom = `2px solid ${COLORS[color].hex}`;
      span.style.cursor = 'pointer';
      span.style.pointerEvents = '';
    } else {
      span.style.backgroundColor = 'transparent';
      span.style.borderBottom = 'none';
      span.style.cursor = 'default';
      span.style.pointerEvents = 'none';
    }
  });
}

function setHighlightsVisible(visible) {
  notes.forEach((note) => {
    if (!note?.id || !note?.color) return;
    setHighlightVisibleById(note.id, note.color, visible);
  });
}

function syncTextFromCards() {
  if (!shadowRoot) return;
  const textareas = shadowRoot.querySelectorAll('.ln-note-card textarea');
  textareas.forEach((textarea) => {
    const card = textarea.closest('.ln-note-card');
    const noteId = card?.dataset?.id;
    if (!noteId) return;
    const note = notes.find((item) => item.id === noteId);
    if (note) note.text = textarea.value;
  });
}

function deleteNote(id) {
  notes = notes.filter((n) => n.id !== id);
  saveNotes();

  const bubble = shadowRoot.querySelector(`.ln-bubble[data-id="${id}"]`);
  const card = shadowRoot.querySelector(`.ln-note-card[data-id="${id}"]`);

  if (bubble) bubble.remove();
  if (card) card.remove();

  removeHighlightById(id);
}

// --- Storage ---
function loadNotes() {
  const currentPageKey = getCurrentPageKey();
  console.log('LingoNote Debug: loading notes for', currentPageKey);

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const storedNotes = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];

    notes = storedNotes
      .filter((note) => {
        const noteUrl = note?.anchor?.url;
        if (!noteUrl) return true;
        return normalizeUrl(noteUrl) === currentPageKey;
      })
      .map((note) => ({
        ...note,
        anchor: {
          ...(note.anchor || {}),
          url: currentPageKey,
        },
      }));

    if (!notes.length) {
      console.log('LingoNote Debug: no notes for current page');
      return;
    }

    notes.forEach((note) => {
      reconstructHighlight(note);
      updateNoteAnchorFromHighlight(note);
      renderNote(note, false);
    });

    if (!isExtensionEnabled) {
      setHighlightsVisible(false);
    }

    // Reposition once after delayed page layout settles.
    setTimeout(() => {
      repositionElements();
      saveNotes();
    }, 1200);
  });
}

function reconstructHighlight(note) {
  const targetText = note?.anchor?.text;
  if (!targetText) return;

  if (document.querySelector(`.ln-highlight-span[data-id="${note.id}"]`)) {
    updateNoteAnchorFromHighlight(note);
    return;
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  let bestMatch = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const targetTop = Number(note?.anchor?.scrollTop) || 0;
  const targetLeft = Number(note?.anchor?.scrollLeft) || 0;

  while ((node = walker.nextNode())) {
    const textContent = node.nodeValue;
    if (!textContent) continue;
    if (['SCRIPT', 'STYLE'].includes(node.parentNode.nodeName)) continue;
    if (node.parentNode.className === 'ln-highlight-span') continue;

    let fromIndex = 0;
    while (fromIndex < textContent.length) {
      const index = textContent.indexOf(targetText, fromIndex);
      if (index === -1) break;

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + targetText.length);
      const rect = getRangeAnchorRect(range);
      const top = rect.top + window.scrollY;
      const left = rect.left + (rect.width / 2) + window.scrollX;
      const distance = Math.hypot(top - targetTop, left - targetLeft);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = range;
      }

      fromIndex = index + targetText.length;
    }
  }

  if (bestMatch) {
    applyHighlightToRange(bestMatch, note.id, note.color);
    updateNoteAnchorFromHighlight(note);
    if (!isExtensionEnabled) {
      setHighlightVisibleById(note.id, note.color, false);
    }
  }
}

function repositionElements() {
  notes.forEach((note) => {
    const updated = updateNoteAnchorFromHighlight(note);
    if (updated) positionNoteUI(note);
  });
}

function saveNotes() {
  syncTextFromCards();

  const currentPageKey = getCurrentPageKey();
  const currentPageNotes = notes.map((note) => ({
    ...note,
    anchor: {
      ...(note.anchor || {}),
      url: currentPageKey,
    },
  }));

  chrome.storage.local.get([STORAGE_KEY], (result) => {
    const storedNotes = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const currentIds = new Set(currentPageNotes.map((note) => note.id));

    const otherPageNotes = storedNotes.filter((note) => {
      const noteUrl = note?.anchor?.url;
      if (!noteUrl) return !currentIds.has(note.id);
      return normalizeUrl(noteUrl) !== currentPageKey;
    });

    const mergedNotes = [...otherPageNotes, ...currentPageNotes];

    chrome.storage.local.set({ [STORAGE_KEY]: mergedNotes }, () => {
      if (chrome.runtime.lastError) {
        console.error('LingoNote Debug: save failed ->', chrome.runtime.lastError);
      }
    });
  });
}

// --- Extension Toggle ---
function setExtensionEnabled(enabled) {
  isExtensionEnabled = enabled;

  if (shadowHost) {
    shadowHost.style.display = enabled ? '' : 'none';
  }

  setHighlightsVisible(enabled);

  if (!enabled) {
    hideToolbar();
    hideAllCards();
  }
}

function setupMessageListener() {
  if (messageListenerRegistered) return;
  messageListenerRegistered = true;

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'LINGONOTE_TOGGLE') {
      setExtensionEnabled(!isExtensionEnabled);
      sendResponse({ enabled: isExtensionEnabled });
      return true;
    }

    if (message.type === 'LINGONOTE_GET_STATE') {
      sendResponse({ enabled: isExtensionEnabled });
      return true;
    }
  });
}

// --- Utils ---
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
