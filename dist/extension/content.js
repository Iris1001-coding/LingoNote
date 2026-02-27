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
const watchedScrollContainers = new WeakSet();
let repositionRaf = 0;
let anchorRecoveryObserver = null;
let anchorRecoveryInterval = null;
let anchorRecoveryStopTimeout = null;

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

const SCROLLABLE_OVERFLOW_RE = /(auto|scroll|overlay)/i;

function isScrollableElement(element) {
  if (!element || element === document.body || element === document.documentElement) return false;
  const style = getComputedStyle(element);
  const canScrollY = SCROLLABLE_OVERFLOW_RE.test(style.overflowY)
    && element.scrollHeight > element.clientHeight + 1;
  const canScrollX = SCROLLABLE_OVERFLOW_RE.test(style.overflowX)
    && element.scrollWidth > element.clientWidth + 1;
  return canScrollY || canScrollX;
}

function getNearestScrollParent(node) {
  let current = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  while (current && current !== document.body) {
    if (isScrollableElement(current)) return current;
    current = current.parentElement;
  }
  return window;
}

function scheduleReposition() {
  if (repositionRaf) return;
  repositionRaf = requestAnimationFrame(() => {
    repositionRaf = 0;
    if (!isExtensionEnabled || !notes.length) return;
    repositionElements();
  });
}

function stopAnchorRecovery() {
  if (anchorRecoveryObserver) {
    anchorRecoveryObserver.disconnect();
    anchorRecoveryObserver = null;
  }
  if (anchorRecoveryInterval) {
    clearInterval(anchorRecoveryInterval);
    anchorRecoveryInterval = null;
  }
  if (anchorRecoveryStopTimeout) {
    clearTimeout(anchorRecoveryStopTimeout);
    anchorRecoveryStopTimeout = null;
  }
}

function hasHighlightForNoteId(noteId) {
  if (!noteId) return false;
  return !!document.querySelector(`.ln-highlight-span[data-id="${noteId}"]`);
}

function getMissingHighlightNotes() {
  return notes.filter((note) => note?.id && !hasHighlightForNoteId(note.id));
}

function recoverMissingHighlights() {
  const missing = getMissingHighlightNotes();
  if (!missing.length) return 0;

  missing.forEach((note) => {
    reconstructHighlight(note);
  });

  return getMissingHighlightNotes().length;
}

function startAnchorRecovery(durationMs = 12000) {
  stopAnchorRecovery();

  const tick = () => {
    if (!isExtensionEnabled || !notes.length) return;
    recoverMissingHighlights();
    repositionElements();
  };

  anchorRecoveryInterval = setInterval(tick, 500);
  anchorRecoveryStopTimeout = setTimeout(stopAnchorRecovery, durationMs);

  if (window.MutationObserver && document.body) {
    anchorRecoveryObserver = new MutationObserver(() => {
      scheduleReposition();
    });
    anchorRecoveryObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }
}

function watchScrollContainer(target) {
  if (!target || target === window || watchedScrollContainers.has(target)) return;
  watchedScrollContainers.add(target);
  target.addEventListener('scroll', scheduleReposition, { passive: true });
}

function watchNoteScrollParent(noteId) {
  if (!noteId) return;
  const span = document.querySelector(`.ln-highlight-span[data-id="${noteId}"]`);
  if (!span) return;
  const scrollParent = getNearestScrollParent(span);
  if (scrollParent !== window) watchScrollContainer(scrollParent);
}

function getHighlightSpanFromNode(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element?.closest) return null;
  return element.closest('.ln-highlight-span[data-id]');
}

function ensureNoteCardById(id) {
  if (!shadowRoot || !id) return null;
  let card = shadowRoot.querySelector(`.ln-note-card[data-id="${id}"]`);
  if (card) return card;
  const note = notes.find((item) => item.id === id);
  if (!note) return null;
  renderNote(note, false);
  card = shadowRoot.querySelector(`.ln-note-card[data-id="${id}"]`);
  return card;
}

function openNoteCardById(id) {
  const card = ensureNoteCardById(id);
  if (!card) return;
  hideAllCards();
  card.classList.add('visible');
}

function getOverlapNoteIds(range) {
  const ids = new Set();
  const startSpan = getHighlightSpanFromNode(range.startContainer);
  const endSpan = getHighlightSpanFromNode(range.endContainer);
  if (startSpan?.dataset?.id) ids.add(startSpan.dataset.id);
  if (endSpan?.dataset?.id) ids.add(endSpan.dataset.id);

  const spans = getIntersectingHighlightSpans(range);
  spans.forEach((span) => {
    if (span.dataset.id) ids.add(span.dataset.id);
  });

  return [...ids];
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
  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('wheel', scheduleReposition, { passive: true });
  window.addEventListener('touchmove', scheduleReposition, { passive: true });
  document.addEventListener('scroll', scheduleReposition, { passive: true, capture: true });

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
function applyHighlightVisual(span, color, visible = true, mode = 'base') {
  if (!span || !COLORS[color]) return;
  span.dataset.mode = mode;
  span.style.cursor = visible ? 'pointer' : 'default';
  span.style.pointerEvents = visible ? '' : 'none';

  if (!visible) {
    span.style.backgroundColor = 'transparent';
    span.style.borderBottom = 'none';
    span.style.boxShadow = 'none';
    return;
  }

  if (mode === 'nested') {
    span.style.backgroundColor = 'transparent';
    span.style.borderBottom = `2px dashed ${COLORS[color].hex}`;
    span.style.boxShadow = `inset 0 0 0 1px ${COLORS[color].hex}66`;
    return;
  }

  span.style.backgroundColor = COLORS[color].hl;
  span.style.borderBottom = `2px solid ${COLORS[color].hex}`;
  span.style.boxShadow = 'none';
}

function buildHighlightSpan(id, color, mode = 'base') {
  const span = document.createElement('span');
  span.className = 'ln-highlight-span';
  span.dataset.id = id;
  applyHighlightVisual(span, color, true, mode);
  return span;
}

function unwrapHighlightSpan(span) {
  const parent = span.parentNode;
  if (!parent) return;

  while (span.firstChild) {
    parent.insertBefore(span.firstChild, span);
  }
  parent.removeChild(span);
  parent.normalize();
}

function removeNoteUiById(id) {
  const bubble = shadowRoot?.querySelector(`.ln-bubble[data-id="${id}"]`);
  const card = shadowRoot?.querySelector(`.ln-note-card[data-id="${id}"]`);
  if (bubble) bubble.remove();
  if (card) card.remove();
}

function removeNotesByIds(ids, options = {}) {
  const { removeHighlights = true, save = true } = options;
  const idSet = new Set(ids.filter(Boolean));
  if (!idSet.size) return;

  notes = notes.filter((note) => !idSet.has(note.id));
  idSet.forEach((id) => {
    removeNoteUiById(id);
    if (removeHighlights) removeHighlightById(id);
  });

  if (save) saveNotes();
}

function getIntersectingHighlightSpans(range) {
  const spans = [];
  document.querySelectorAll('.ln-highlight-span[data-id]').forEach((span) => {
    try {
      if (range.intersectsNode(span)) spans.push(span);
    } catch (error) {
      // Ignore invalid DOM states while page is re-rendering.
    }
  });
  return spans;
}

function expandRangeToIncludeNode(range, node) {
  const nodeRange = document.createRange();
  nodeRange.selectNode(node);

  if (nodeRange.compareBoundaryPoints(Range.START_TO_START, range) < 0) {
    range.setStartBefore(node);
  }
  if (nodeRange.compareBoundaryPoints(Range.END_TO_END, range) > 0) {
    range.setEndAfter(node);
  }
}

function collectIntersectedTextSegments(range) {
  const segments = [];
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  if (!root) return segments;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.length === 0) return NodeFilter.FILTER_REJECT;
      const parent = node.parentNode;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.nodeName)) return NodeFilter.FILTER_REJECT;
      if (shadowHost && shadowHost.contains(parent)) return NodeFilter.FILTER_REJECT;
      try {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      } catch (error) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  nodes.forEach((textNode) => {
    let start = 0;
    let end = textNode.nodeValue.length;

    if (textNode === range.startContainer) start = range.startOffset;
    if (textNode === range.endContainer) end = range.endOffset;
    if (range.startContainer === range.endContainer && textNode === range.startContainer) {
      start = range.startOffset;
      end = range.endOffset;
    }

    if (start < end) segments.push({ node: textNode, start, end });
  });

  return segments;
}

function applyHighlightToRange(range, id, color, options = {}) {
  const { mergeOverlaps = false } = options;
  const workingRange = range.cloneRange();

  if (mergeOverlaps) {
    const overlapSpans = getIntersectingHighlightSpans(workingRange);
    if (overlapSpans.length) {
      overlapSpans.forEach((span) => {
        expandRangeToIncludeNode(workingRange, span);
      });

      const overlapIds = [...new Set(overlapSpans.map((span) => span.dataset.id).filter(Boolean))];
      overlapSpans.forEach((span) => unwrapHighlightSpan(span));
      removeNotesByIds(overlapIds, { removeHighlights: false, save: false });
    }
  }

  const segments = collectIntersectedTextSegments(workingRange);
  if (!segments.length) return false;

  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const { node, start, end } = segments[i];
    const partRange = document.createRange();
    partRange.setStart(node, start);
    partRange.setEnd(node, end);
    const isNested = !!node.parentNode?.closest?.('.ln-highlight-span[data-id]');
    const span = buildHighlightSpan(id, color, isNested ? 'nested' : 'base');
    const fragment = partRange.extractContents();
    span.appendChild(fragment);
    partRange.insertNode(span);
  }

  return true;
}

function getRangeAnchorRect(range) {
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return range.getBoundingClientRect();
}

function getRangeTailRect(range) {
  const rects = range.getClientRects();
  for (let i = rects.length - 1; i >= 0; i -= 1) {
    const rect = rects[i];
    if (rect.width > 0 || rect.height > 0) return rect;
  }
  return range.getBoundingClientRect();
}

function isIgnoredTextParent(parent) {
  if (!parent) return true;
  if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.nodeName)) return true;
  if (shadowHost && shadowHost.contains(parent)) return true;
  return false;
}

function findNodeIndexByGlobalOffset(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, hi);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectTextMatchCandidates(fullText, targetText) {
  const candidates = [];
  if (!targetText) return candidates;

  // Exact matches first.
  let fromIndex = 0;
  while (fromIndex < fullText.length) {
    const index = fullText.indexOf(targetText, fromIndex);
    if (index === -1) break;
    candidates.push({ start: index, end: index + targetText.length });
    fromIndex = index + 1;
  }

  if (candidates.length) return candidates;

  // Fallback: ignore whitespace shape differences (spaces/newlines/tabs).
  const tokens = targetText.trim().split(/\s+/).filter(Boolean).map(escapeRegExp);
  if (!tokens.length) return candidates;
  const regex = new RegExp(tokens.join('\\s+'), 'g');
  let match;
  while ((match = regex.exec(fullText))) {
    const start = match.index;
    const end = start + match[0].length;
    candidates.push({ start, end });
    if (match[0].length === 0) regex.lastIndex += 1;
  }

  return candidates;
}

function findBestRangeByTextAcrossNodes(targetText, targetTop, targetLeft) {
  if (!targetText) return null;

  const nodes = [];
  const starts = [];
  let fullText = '';

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
  let node;
  while ((node = walker.nextNode())) {
    const text = node.nodeValue;
    if (!text) continue;
    if (isIgnoredTextParent(node.parentNode)) continue;
    starts.push(fullText.length);
    nodes.push(node);
    fullText += text;
  }

  if (!fullText || !nodes.length) return null;

  let bestRange = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const candidates = collectTextMatchCandidates(fullText, targetText);

  candidates.forEach(({ start, end }) => {
    const endIndexExclusive = end;
    const startNodeIndex = findNodeIndexByGlobalOffset(starts, start);
    const endNodeIndex = findNodeIndexByGlobalOffset(starts, Math.max(start, endIndexExclusive - 1));
    const startNode = nodes[startNodeIndex];
    const endNode = nodes[endNodeIndex];

    const startOffset = start - starts[startNodeIndex];
    const endOffset = endIndexExclusive - starts[endNodeIndex];

    if (
      startNode
      && endNode
      && startOffset >= 0
      && endOffset >= 0
      && startOffset <= startNode.nodeValue.length
      && endOffset <= endNode.nodeValue.length
    ) {
      const candidate = document.createRange();
      candidate.setStart(startNode, startOffset);
      candidate.setEnd(endNode, endOffset);

      const rect = getRangeTailRect(candidate);
      const top = rect.top + window.scrollY;
      const left = rect.right + window.scrollX;
      const distance = Math.hypot(top - targetTop, left - targetLeft);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestRange = candidate;
      }
    }
  });

  return bestRange;
}

function getHighlightAnchorRectById(id) {
  const spans = document.querySelectorAll(`.ln-highlight-span[data-id="${id}"]`);
  for (let i = spans.length - 1; i >= 0; i -= 1) {
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
  note.anchor.scrollLeft = rect.right + window.scrollX;
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

function setNoteAnchoredState(noteId, anchored) {
  if (!shadowRoot) return;
  const bubble = shadowRoot.querySelector(`.ln-bubble[data-id="${noteId}"]`);
  const card = shadowRoot.querySelector(`.ln-note-card[data-id="${noteId}"]`);
  if (!bubble || !card) return;

  if (anchored) {
    bubble.style.visibility = '';
    bubble.style.pointerEvents = '';
    return;
  }

  bubble.style.visibility = 'hidden';
  bubble.style.pointerEvents = 'none';
  card.classList.remove('visible');
}

function createNote(color) {
  if (!isExtensionEnabled) return;
  if (!activeSelection) return;

  const range = activeSelection.cloneRange();
  const text = range.toString().trim();
  if (!text) return;
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);

  const scrollParent = getNearestScrollParent(range.startContainer);
  if (scrollParent !== window) watchScrollContainer(scrollParent);

  const tailRect = getRangeTailRect(range);
  if (tailRect.width === 0 && tailRect.height === 0) return;

  const applied = applyHighlightToRange(range, id, color, { mergeOverlaps: false });
  if (!applied) return;

  const scrollTop = tailRect.top + window.scrollY;
  const scrollLeft = tailRect.right + window.scrollX;

  const anchor = {
    text,
    scrollTop,
    scrollLeft,
    url: getCurrentPageKey(),
  };

  const note = { id, color, text: '', anchor, createdAt: Date.now() };

  // Prefer exact highlight geometry over raw selection bounds.
  updateNoteAnchorFromHighlight(note);
  watchNoteScrollParent(note.id);

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

  const anchored = updateNoteAnchorFromHighlight(note);

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
  watchNoteScrollParent(note.id);

  if (autoShow) {
    setTimeout(() => {
      hideAllCards();
      card.classList.add('visible');
    }, 10);
  }

  positionNoteUI(note);
  setNoteAnchoredState(note.id, anchored);
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
    const mode = span.dataset.mode || 'base';
    applyHighlightVisual(span, color, visible, mode);
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
      stopAnchorRecovery();
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
      recoverMissingHighlights();
      repositionElements();
      saveNotes();
    }, 1200);

    startAnchorRecovery(20000);
  });
}

function reconstructHighlight(note) {
  const targetText = note?.anchor?.text;
  if (!targetText) return;

  if (document.querySelector(`.ln-highlight-span[data-id="${note.id}"]`)) {
    updateNoteAnchorFromHighlight(note);
    watchNoteScrollParent(note.id);
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
    if (isIgnoredTextParent(node.parentNode)) continue;

    let fromIndex = 0;
    while (fromIndex < textContent.length) {
      const index = textContent.indexOf(targetText, fromIndex);
      if (index === -1) break;

      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + targetText.length);
      const tailRect = getRangeTailRect(range);
      const top = tailRect.top + window.scrollY;
      const left = tailRect.right + window.scrollX;
      const distance = Math.hypot(top - targetTop, left - targetLeft);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = range;
      }

      fromIndex = index + targetText.length;
    }
  }

  if (!bestMatch) {
    bestMatch = findBestRangeByTextAcrossNodes(targetText, targetTop, targetLeft);
  }

  if (bestMatch) {
    const applied = applyHighlightToRange(bestMatch, note.id, note.color, { mergeOverlaps: false });
    if (applied) {
      updateNoteAnchorFromHighlight(note);
      watchNoteScrollParent(note.id);
      if (!isExtensionEnabled) {
        setHighlightVisibleById(note.id, note.color, false);
      }
    }
  }
}

function repositionElements() {
  notes.forEach((note) => {
    const updated = updateNoteAnchorFromHighlight(note);
    if (updated) positionNoteUI(note);
    setNoteAnchoredState(note.id, updated);
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
    stopAnchorRecovery();
    hideToolbar();
    hideAllCards();
  } else if (notes.length) {
    startAnchorRecovery(6000);
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
