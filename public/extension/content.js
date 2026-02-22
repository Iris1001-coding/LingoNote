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

// --- State ---
let shadowHost = null;
let shadowRoot = null;
let activeSelection = null;
let notes = [];
let toolbar = null;
let legend = null;
let isLegendCollapsed = false;
let legendTitle = "LingoNote";

// --- Initialization ---
function init() {
  // Prevent running on the demo page to avoid duplicate UI
  if (document.body.classList.contains('ln-demo-page')) {
    console.log('LingoNote: Demo page detected, extension disabled.');
    return;
  }

  // Watch for class changes (in case React adds it late)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class' && document.body.classList.contains('ln-demo-page')) {
        console.log('LingoNote: Demo page detected late, removing UI.');
        if (shadowHost) shadowHost.remove();
        observer.disconnect();
      }
    });
  });
  observer.observe(document.body, { attributes: true });

  setupShadowDOM();
  setupSelectionListener();
  loadNotes();
  
  // Handle window resize/scroll to update positions
  window.addEventListener('resize', debounce(repositionElements, 100));
}

function setupShadowDOM() {
  // Create the shadow host
  shadowHost = document.createElement('div');
  shadowHost.id = 'lingonote-host';
  document.body.appendChild(shadowHost);

  // Attach shadow DOM
  shadowRoot = shadowHost.attachShadow({ mode: 'open' });

  // Inject styles
  const styleLink = document.createElement('link');
  styleLink.rel = 'stylesheet';
  styleLink.href = chrome.runtime.getURL('styles.css');
  shadowRoot.appendChild(styleLink);

  createToolbar();
  createLegend();
}

function createToolbar() {
  if (toolbar) return; // Prevent duplicates

  toolbar = document.createElement('div');
  toolbar.className = 'ln-toolbar';
  
  let buttonsHtml = '';
  Object.entries(COLORS).forEach(([key, val]) => {
    buttonsHtml += `<div class="ln-color-btn ln-c-${key}" data-color="${key}" title="${val.label}"></div>`;
  });
  
  toolbar.innerHTML = buttonsHtml;
  shadowRoot.appendChild(toolbar);

  toolbar.querySelectorAll('.ln-color-btn').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // Prevent losing selection
      e.stopPropagation();
      const color = btn.dataset.color;
      createNote(color);
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
    <div class="ln-legend-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
    </div>
  `;
  shadowRoot.appendChild(legend);
  updateLegend();
  makeDraggable(legend);

  // Toggle Collapse
  const toggleBtn = legend.querySelector('.ln-legend-toggle');
  const icon = legend.querySelector('.ln-legend-icon');
  
  const toggle = (e) => {
    e.stopPropagation();
    isLegendCollapsed = !isLegendCollapsed;
    if (isLegendCollapsed) {
      legend.classList.add('collapsed');
    } else {
      legend.classList.remove('collapsed');
    }
  };

  toggleBtn.addEventListener('click', toggle);
  icon.addEventListener('click', toggle);

  // Title Edit
  const titleEl = legend.querySelector('.ln-legend-title');
  titleEl.addEventListener('blur', (e) => {
    legendTitle = e.target.innerText;
    // In real app, save to storage
  });
}

function updateLegend() {
  if (!legend) return;
  const list = legend.querySelector('.ln-legend-list');
  if (!list) return;

  let html = '';
  Object.entries(COLORS).forEach(([key, val]) => {
    html += `
      <div class="ln-legend-item">
        <div class="ln-legend-dot ln-c-${key}"></div>
        <div class="ln-legend-label" contenteditable="true" data-key="${key}">${val.label}</div>
      </div>
    `;
  });
  list.innerHTML = html;

  // Allow editing labels
  list.querySelectorAll('.ln-legend-label').forEach(el => {
    el.addEventListener('blur', (e) => {
      const key = e.target.dataset.key;
      if (key && COLORS[key]) {
        COLORS[key].label = e.target.innerText;
        // Update existing tooltips
        const btn = toolbar?.querySelector(`.ln-color-btn[data-color="${key}"]`);
        if (btn) btn.setAttribute('title', COLORS[key].label);
        // Save config (in real app, save to storage)
      }
    });
  });
}

function makeDraggable(element) {
  let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
  const header = element.querySelector('.ln-legend-header');
  const icon = element.querySelector('.ln-legend-icon');

  const dragMouseDown = (e) => {
    e = e || window.event;
    // Only drag if not editing text
    if (e.target.isContentEditable) return;

    e.preventDefault();
    pos3 = e.clientX;
    pos4 = e.clientY;
    document.onmouseup = closeDragElement;
    document.onmousemove = elementDrag;
  };

  if (header) header.onmousedown = dragMouseDown;
  if (icon) icon.onmousedown = dragMouseDown;

  function elementDrag(e) {
    e = e || window.event;
    e.preventDefault();
    pos1 = pos3 - e.clientX;
    pos2 = pos4 - e.clientY;
    pos3 = e.clientX;
    pos4 = e.clientY;
    element.style.top = (element.offsetTop - pos2) + "px";
    element.style.left = (element.offsetLeft - pos1) + "px";
    element.style.right = 'auto';
    element.style.bottom = 'auto';
  }

  function closeDragElement() {
    document.onmouseup = null;
    document.onmousemove = null;
  }
}

// --- Selection Handling ---
function setupSelectionListener() {
  document.addEventListener('mouseup', (e) => {
    // Ignore events inside the demo container to prevent double toolbars
    if (e.target.closest('.ln-demo-container')) {
      return;
    }

    // Wait a tick to let selection settle
    setTimeout(() => {
      const selection = window.getSelection();
      
      // Ignore if selection is empty or inside our shadow DOM
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
  
  // Calculate position relative to viewport + scroll
  const top = rect.top + window.scrollY;
  const left = rect.left + (rect.width / 2) + window.scrollX;

  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.classList.add('visible');
}

function hideToolbar() {
  if (toolbar) toolbar.classList.remove('visible');
  activeSelection = null;
}

// --- Note Creation ---
function createNote(color) {
  if (!activeSelection) return;

  const range = activeSelection;
  const text = range.toString();
  
  // Create unique ID
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2);

  // 1. Capture coordinates BEFORE modifying DOM
  const rect = range.getBoundingClientRect();
  
  // Check validity
  if (rect.width === 0 && rect.height === 0) {
      console.warn("Invalid selection rect");
      return;
  }

  const scrollTop = rect.top + window.scrollY;
  const scrollLeft = rect.left + window.scrollX;

  // 2. Try to highlight (Robust)
  const span = document.createElement('span');
  span.style.backgroundColor = COLORS[color].hl;
  span.style.borderBottom = `2px solid ${COLORS[color].hex}`;
  span.style.cursor = 'pointer';
  span.className = 'ln-highlight-span';
  span.dataset.id = id;
  
  try {
    range.surroundContents(span);
  } catch (e) {
    // Fallback: Extract and wrap
    const fragment = range.extractContents();
    span.appendChild(fragment);
    range.insertNode(span);
  }

  // 3. Overlap / Stacking Logic
  const nearbyNotes = notes.filter(n => 
    Math.abs(n.anchor.scrollTop - scrollTop) < 15 && 
    Math.abs(n.anchor.scrollLeft - scrollLeft) < 50
  );
  
  let finalTop = scrollTop;
  let finalLeft = scrollLeft;

  if (nearbyNotes.length > 0) {
      // Stack upwards
      finalTop = scrollTop - (15 * nearbyNotes.length);
  }

  const anchor = {
    text: text,
    scrollTop: finalTop,
    scrollLeft: finalLeft
  };

  const note = {
    id,
    color,
    text: '',
    anchor,
    createdAt: Date.now()
  };

  notes.push(note);
  saveNotes();
  renderNote(note);
  
  // Clear selection and toolbar
  window.getSelection().removeAllRanges();
  hideToolbar();
}

// --- Rendering ---
function renderNote(note) {
  // 1. Create Bubble
  const bubble = document.createElement('div');
  bubble.className = `ln-bubble ln-c-${note.color}`;
  bubble.dataset.id = note.id;
  bubble.style.top = `${note.anchor.scrollTop}px`;
  bubble.style.left = `${note.anchor.scrollLeft}px`;

  // Preview Tooltip
  const preview = document.createElement('div');
  preview.className = 'ln-bubble-preview';
  preview.innerText = COLORS[note.color].label;
  bubble.appendChild(preview);

  // 2. Create Note Card (Hidden by default)
  const card = document.createElement('div');
  card.className = 'ln-note-card';
  card.dataset.id = note.id;
  card.innerHTML = `
    <div class="ln-note-header">
      <div class="ln-note-type">
        <div class="ln-note-dot ln-bubble ln-c-${note.color}" style="position:static; transform:none;"></div>
        <span>${COLORS[note.color].label}</span>
      </div>
      <div class="ln-actions">
        <button class="ln-icon-btn minimize" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
        </button>
        <button class="ln-icon-btn delete" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </div>
    </div>
    <textarea class="ln-note-content" placeholder="Add a note...">${note.text}</textarea>
    <div class="ln-highlight-text">"${note.anchor.text}"</div>
  `;

  card.style.top = `${note.anchor.scrollTop + 20}px`;
  card.style.left = `${note.anchor.scrollLeft}px`;

  // Events
  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCard(card);
  });

  card.addEventListener('click', (e) => e.stopPropagation());
  
  // Minimize
  card.querySelector('.minimize').addEventListener('click', (e) => {
    e.stopPropagation();
    card.classList.remove('visible');
  });

  // Auto-save on input
  const textarea = card.querySelector('textarea');
  textarea.addEventListener('input', debounce((e) => {
    note.text = e.target.value;
    preview.innerText = note.text || COLORS[note.color].label;
    saveNotes();
  }, 500));

  // Delete
  card.querySelector('.delete').addEventListener('click', () => {
    deleteNote(note.id);
  });

  shadowRoot.appendChild(bubble);
  shadowRoot.appendChild(card);
  
  setTimeout(() => card.classList.add('visible'), 10);
}

function toggleCard(card) {
  // Close others
  shadowRoot.querySelectorAll('.ln-note-card.visible').forEach(c => {
    if (c !== card) c.classList.remove('visible');
  });
  card.classList.toggle('visible');
}

function deleteNote(id) {
  notes = notes.filter(n => n.id !== id);
  saveNotes();
  
  // Remove UI
  const bubble = shadowRoot.querySelector(`.ln-bubble[data-id="${id}"]`);
  const card = shadowRoot.querySelector(`.ln-note-card[data-id="${id}"]`);
  if (bubble) bubble.remove();
  if (card) card.remove();

  // Remove Highlight Span(s)
  // Use document.querySelectorAll to catch all fragments if the range was split
  const spans = document.querySelectorAll(`.ln-highlight-span[data-id="${id}"]`);
  spans.forEach(span => {
    const parent = span.parentNode;
    if (parent) {
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    }
  });
}

function repositionElements() {
  // In a real app, this would re-scan the DOM for the text anchors 
  // and update the top/left of bubbles and cards.
  // For this demo, we assume static content or simple resize.
}

// --- Storage ---
function loadNotes() {
  chrome.storage.sync.get(['lingonotes'], (result) => {
    if (result.lingonotes) {
      notes = result.lingonotes;
      notes.forEach(renderNote);
    }
  });
}

function saveNotes() {
  chrome.storage.sync.set({ lingonotes: notes });
}

// --- Utils ---
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Run
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
