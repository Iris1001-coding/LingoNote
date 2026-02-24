import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Highlighter, BookOpen, Trash2, Info, Check, X, Settings, GripVertical, Minimize2 } from 'lucide-react';

const RELEASE_ZIP_URL = 'https://github.com/Iris1001-coding/LingoNote/releases/download/v1.0.1/LingoNote_v1.0.1.zip';

const downloadExtension = () => {
  window.open(RELEASE_ZIP_URL, '_blank', 'noopener,noreferrer');
};

// --- Demo Logic (Simulates the Extension) ---
class LingoNoteDemo {
  private container: HTMLElement;
  private shadowHost: HTMLElement;
  private shadowRoot: ShadowRoot;
  private activeSelection: Range | null = null;
  private notes: any[] = [];
  private toolbar: HTMLElement | null = null;
  private legend: HTMLElement | null = null;
  private isLegendCollapsed: boolean = false;
  private legendTitle: string = "LingoNote";
  
  // Configuration
  private colors: Record<string, { hex: string, label: string, hl: string }> = {
    red: { hex: '#FF5252', label: 'Missed', hl: 'rgba(255, 82, 82, 0.2)' },
    blue: { hex: '#448AFF', label: 'Synonym', hl: 'rgba(68, 138, 255, 0.2)' },
    green: { hex: '#69F0AE', label: 'Key Point', hl: 'rgba(105, 240, 174, 0.2)' },
    yellow: { hex: '#FFD740', label: 'General', hl: 'rgba(255, 215, 64, 0.2)' },
    purple: { hex: '#E040FB', label: 'Grammar', hl: 'rgba(224, 64, 251, 0.2)' },
    orange: { hex: '#FFAB40', label: 'Vocab', hl: 'rgba(255, 171, 64, 0.2)' }
  };

  constructor(container: HTMLElement) {
    this.container = container;
    
    // Cleanup any existing demo hosts in this container to prevent duplicates
    const existingHosts = this.container.querySelectorAll('.ln-demo-host');
    existingHosts.forEach(h => h.remove());

    this.shadowHost = document.createElement('div');
    this.shadowHost.className = 'ln-demo-host'; // Add class for identification
    this.shadowHost.style.position = 'absolute';
    this.shadowHost.style.top = '0';
    this.shadowHost.style.left = '0';
    this.shadowHost.style.width = '100%';
    this.shadowHost.style.height = '100%';
    this.shadowHost.style.pointerEvents = 'none';
    this.shadowHost.style.zIndex = '10';
    
    this.container.style.position = 'relative';
    this.container.appendChild(this.shadowHost);
    this.shadowRoot = this.shadowHost.attachShadow({ mode: 'open' });
    
    this.init();
  }

  async init() {
    const styleRes = await fetch('./extension/styles.css');
    const css = await styleRes.text();
    const style = document.createElement('style');
    style.textContent = css;
    this.shadowRoot.appendChild(style);

    this.createToolbar();
    this.createLegend();

    this.container.addEventListener('mouseup', this.handleMouseUp.bind(this));
    this.notes = []; 
  }

  createToolbar() {
    // Only create if not exists
    if (this.toolbar) return;

    this.toolbar = document.createElement('div');
    this.toolbar.className = 'ln-toolbar';
    
    let buttonsHtml = '';
    Object.entries(this.colors).forEach(([key, val]) => {
      buttonsHtml += `<div class="ln-color-btn ln-c-${key}" data-color="${key}" title="${val.label}"></div>`;
    });
    
    this.toolbar.innerHTML = buttonsHtml;
    this.shadowRoot.appendChild(this.toolbar);

    this.toolbar.querySelectorAll('.ln-color-btn').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const color = (btn as HTMLElement).dataset.color;
        if (color) this.createNote(color);
      });
    });
  }

  createLegend() {
    if (this.legend) return;

    this.legend = document.createElement('div');
    this.legend.className = 'ln-legend';
    this.legend.innerHTML = `
      <div class="ln-legend-header">
        <div class="ln-legend-title" contenteditable="true">${this.legendTitle}</div>
        <div class="ln-legend-toggle" title="Minimize">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
        </div>
      </div>
      <div class="ln-legend-list"></div>
      <div class="ln-legend-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
      </div>
    `;
    this.shadowRoot.appendChild(this.legend);
    this.updateLegend();
    this.makeDraggable(this.legend);

    // Toggle Collapse
    const toggleBtn = this.legend.querySelector('.ln-legend-toggle');
    const icon = this.legend.querySelector('.ln-legend-icon');
    
    const toggle = (e: Event) => {
      e.stopPropagation();
      this.isLegendCollapsed = !this.isLegendCollapsed;
      if (this.isLegendCollapsed) {
        this.legend?.classList.add('collapsed');
      } else {
        this.legend?.classList.remove('collapsed');
      }
    };

    toggleBtn?.addEventListener('click', toggle);
    icon?.addEventListener('click', toggle);

    // Title Edit
    const titleEl = this.legend.querySelector('.ln-legend-title');
    titleEl?.addEventListener('blur', (e) => {
      this.legendTitle = (e.target as HTMLElement).innerText;
    });
  }

  updateLegend() {
    if (!this.legend) return;
    const list = this.legend.querySelector('.ln-legend-list');
    if (!list) return;

    let html = '';
    Object.entries(this.colors).forEach(([key, val]) => {
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
        const target = e.target as HTMLElement;
        const key = target.dataset.key;
        if (key && this.colors[key]) {
          this.colors[key].label = target.innerText;
          const btn = this.toolbar?.querySelector(`.ln-color-btn[data-color="${key}"]`);
          if (btn) btn.setAttribute('title', this.colors[key].label);
        }
      });
    });
  }

  makeDraggable(element: HTMLElement) {
    let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
    const header = element.querySelector('.ln-legend-header') as HTMLElement;
    const icon = element.querySelector('.ln-legend-icon') as HTMLElement;
    
    const dragMouseDown = (e: MouseEvent) => {
      e = e || window.event;
      // Only drag if not editing text
      if ((e.target as HTMLElement).isContentEditable) return;
      
      e.preventDefault();
      pos3 = e.clientX;
      pos4 = e.clientY;
      document.onmouseup = closeDragElement;
      document.onmousemove = elementDrag;
    };

    if (header) header.onmousedown = dragMouseDown;
    if (icon) icon.onmousedown = dragMouseDown;

    function elementDrag(e: MouseEvent) {
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

  handleMouseUp(e: MouseEvent) {
    setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !this.container.contains(selection.anchorNode)) {
        this.hideToolbar();
        return;
      }

      const text = selection.toString().trim();
      if (text.length > 0) {
        this.activeSelection = selection.getRangeAt(0);
        this.showToolbar(this.activeSelection);
      } else {
        this.hideToolbar();
      }
    }, 10);
  }

  showToolbar(range: Range) {
    if (!this.toolbar) return;
    const containerRect = this.container.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    const top = rect.top - containerRect.top;
    const left = rect.left - containerRect.left + (rect.width / 2);

    this.toolbar.style.top = `${top}px`;
    this.toolbar.style.left = `${left}px`;
    this.toolbar.classList.add('visible');
  }

  hideToolbar() {
    if (this.toolbar) this.toolbar.classList.remove('visible');
    this.activeSelection = null;
  }

  createNote(color: string) {
    if (!this.activeSelection) return;

    const range = this.activeSelection;
    const text = range.toString();
    const id = Date.now().toString();
    
    // 1. Capture coordinates BEFORE modifying DOM
    const containerRect = this.container.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    
    // If rect is invalid (0,0), use the last known good position or fallback
    if (rect.width === 0 && rect.height === 0) {
        console.warn("Invalid selection rect");
        return;
    }

    const scrollTop = rect.top - containerRect.top;
    const scrollLeft = rect.left - containerRect.left;

    // 2. Try to highlight
    const span = document.createElement('span');
    span.style.backgroundColor = this.colors[color].hl;
    span.style.borderBottom = `2px solid ${this.colors[color].hex}`;
    span.style.cursor = 'pointer';
    span.className = 'ln-highlight-span';
    span.dataset.id = id; // Add ID for deletion
    
    try {
      range.surroundContents(span);
    } catch (e) {
      console.warn("Highlight overlap detected. Skipping visual highlight, but adding note.");
    }

    // 3. Overlap / Stacking Logic
    // Find notes that are very close to this one
    const nearbyNotes = this.notes.filter(n => 
      Math.abs(n.anchor.scrollTop - scrollTop) < 15 && 
      Math.abs(n.anchor.scrollLeft - scrollLeft) < 50 // Check horizontal proximity too
    );
    
    // If there are nearby notes, stack this one slightly offset
    // We'll stack them horizontally if on same line, or vertically if needed.
    // Let's try a simple horizontal shift first, or vertical stack if crowded.
    
    let finalTop = scrollTop;
    let finalLeft = scrollLeft;

    if (nearbyNotes.length > 0) {
        // Simple stacking: move up slightly to create a "totem" effect
        // or move right.
        // Let's move UP so we don't block text.
        finalTop = scrollTop - (15 * nearbyNotes.length);
    }

    const note = {
      id,
      color,
      text: '',
      anchor: { text, scrollTop: finalTop, scrollLeft: finalLeft },
      createdAt: Date.now()
    };

    this.notes.push(note);
    this.renderNote(note);
    
    window.getSelection()?.removeAllRanges();
    this.hideToolbar();
  }

  renderNote(note: any) {
    // Bubble
    const bubble = document.createElement('div');
    bubble.className = `ln-bubble ln-c-${note.color}`;
    bubble.dataset.id = note.id;
    bubble.style.top = `${note.anchor.scrollTop}px`;
    bubble.style.left = `${note.anchor.scrollLeft}px`;
    bubble.style.position = 'absolute';
    
    // Preview Tooltip
    const preview = document.createElement('div');
    preview.className = 'ln-bubble-preview';
    preview.innerText = this.colors[note.color].label; 
    bubble.appendChild(preview);

    // Card
    const card = document.createElement('div');
    card.className = 'ln-note-card';
    card.dataset.id = note.id;
    card.innerHTML = `
      <div class="ln-note-header">
        <div class="ln-note-type">
          <div class="ln-note-dot ln-bubble ln-c-${note.color}" style="position:static; transform:none;"></div>
          <span>${this.colors[note.color].label}</span>
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
      <textarea class="ln-note-content" placeholder="Add a note...">${note.text}</textarea>
      <div class="ln-highlight-text">"${note.anchor.text}"</div>
    `;
    card.style.top = `${note.anchor.scrollTop + 20}px`;
    card.style.left = `${note.anchor.scrollLeft}px`;
    card.style.position = 'absolute';

    // Events
    bubble.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCard(card);
    });
    
    card.addEventListener('click', (e) => e.stopPropagation());
    
    card.querySelector('.minimize')?.addEventListener('click', (e) => {
      e.stopPropagation();
      card.classList.remove('visible');
    });

    card.querySelector('.delete')?.addEventListener('click', () => {
      this.deleteNote(note.id);
    });

    const textarea = card.querySelector('textarea');
    textarea?.addEventListener('input', (e) => {
      note.text = (e.target as HTMLTextAreaElement).value;
      preview.innerText = note.text || this.colors[note.color].label;
    });

    this.shadowRoot.appendChild(bubble);
    this.shadowRoot.appendChild(card);
    
    setTimeout(() => card.classList.add('visible'), 10);
  }

  toggleCard(card: HTMLElement) {
    this.shadowRoot.querySelectorAll('.ln-note-card.visible').forEach(c => {
      if (c !== card) c.classList.remove('visible');
    });
    card.classList.toggle('visible');
  }

  deleteNote(id: string) {
    // Find note to get anchor info if needed, though for demo we rely on DOM structure
    this.notes = this.notes.filter(n => n.id !== id);
    
    const bubble = this.shadowRoot.querySelector(`.ln-bubble[data-id="${id}"]`);
    const card = this.shadowRoot.querySelector(`.ln-note-card[data-id="${id}"]`);
    
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
  
  destroy() {
    this.shadowHost.remove();
    this.container.removeEventListener('mouseup', this.handleMouseUp);
  }
}

export default function App() {
  const demoRef = useRef<HTMLDivElement>(null);
  const [demoInstance, setDemoInstance] = useState<LingoNoteDemo | null>(null);

  useEffect(() => {
    if (demoRef.current && !demoInstance) {
      const instance = new LingoNoteDemo(demoRef.current);
      setDemoInstance(instance);
    }
    return () => {
      // Cleanup if needed
    };
  }, [demoRef]);

  return (
    <div className="min-h-screen bg-neutral-50 font-sans text-neutral-900 selection:bg-orange-100 selection:text-orange-900">
      {/* Header */}
      <header className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-neutral-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center text-white font-bold">L</div>
            <span className="font-bold text-xl tracking-tight">LingoNote</span>
          </div>
          <button 
            onClick={downloadExtension}
            className="flex items-center gap-2 bg-neutral-900 text-white px-4 py-2 rounded-full text-sm font-medium hover:bg-neutral-800 transition-colors"
          >
            <Download size={16} />
            Download Extension
          </button>
        </div>
      </header>

      <main className="pt-32 pb-20 px-6">
        {/* Hero */}
        <section className="max-w-3xl mx-auto text-center mb-24">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight mb-6 text-neutral-900">
              Master IELTS Reading <br/>
              <span className="text-orange-500">One Highlight at a Time.</span>
            </h1>
            <p className="text-xl text-neutral-500 mb-10 leading-relaxed max-w-2xl mx-auto">
              A lightweight, distraction-free browser extension designed for serious learners. 
              Highlight, tag, and annotate directly on any webpage.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <button 
                onClick={downloadExtension}
                className="bg-orange-500 text-white px-8 py-4 rounded-full font-semibold text-lg hover:bg-orange-600 transition-transform hover:scale-105 shadow-lg shadow-orange-500/20 flex items-center gap-2"
              >
                <Download size={20} />
                Get LingoNote for Chrome
              </button>
              <a href="#demo" className="bg-white text-neutral-900 border border-neutral-200 px-8 py-4 rounded-full font-semibold text-lg hover:bg-neutral-50 transition-colors">
                Try Live Demo
              </a>
            </div>
          </motion.div>
        </section>

        {/* Features Grid */}
        <section className="max-w-5xl mx-auto mb-32 grid md:grid-cols-3 gap-8">
          {[
            { 
              icon: <Highlighter className="text-red-500" />, 
              title: "Smart Highlighting", 
              desc: "Color-coded system specifically designed for IELTS: Missed (Red), Synonym (Blue), Key Point (Green)." 
            },
            { 
              icon: <BookOpen className="text-blue-500" />, 
              title: "Contextual Notes", 
              desc: "Add notes that stick to the text. Even if the page updates, our robust anchoring algorithm finds your spot." 
            },
            { 
              icon: <Settings className="text-purple-500" />, 
              title: "Customizable Labels", 
              desc: "Tailor your study tags. Rename 'Missed' to 'Grammar' or 'Vocab' to fit your personal learning style." 
            }
          ].map((feature, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className="bg-white p-8 rounded-2xl border border-neutral-100 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="w-12 h-12 bg-neutral-50 rounded-xl flex items-center justify-center mb-6">
                {feature.icon}
              </div>
              <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
              <p className="text-neutral-500 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </section>

        {/* Live Demo */}
        <section id="demo" className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <span className="text-orange-500 font-semibold tracking-wider uppercase text-sm">Interactive Demo</span>
            <h2 className="text-3xl font-bold mt-2">Try it right here</h2>
            <p className="text-neutral-500 mt-4">Select any text below to see the toolbar appear.</p>
          </div>

          <div className="relative bg-white rounded-xl shadow-xl border border-neutral-200 overflow-hidden">
            {/* Browser Chrome */}
            <div className="bg-neutral-100 border-b border-neutral-200 px-4 py-3 flex items-center gap-4">
              <div className="flex gap-2">
                <div className="w-3 h-3 rounded-full bg-red-400"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-400"></div>
                <div className="w-3 h-3 rounded-full bg-green-400"></div>
              </div>
              <div className="flex-1 bg-white h-8 rounded-md border border-neutral-200 flex items-center px-3 text-xs text-neutral-400">
                https://en.wikipedia.org/wiki/Language_acquisition
              </div>
            </div>

            {/* Content */}
            <div 
              ref={demoRef}
              className="p-12 md:p-16 text-lg leading-loose text-neutral-800 font-serif"
              style={{ minHeight: '500px' }}
            >
              <h3 className="text-3xl font-sans font-bold mb-6 text-black">Language Acquisition</h3>
              <p className="mb-6">
                Language acquisition is the process by which humans acquire the capacity to perceive and comprehend language, as well as to produce and use words and sentences to communicate.
                Language acquisition involves structures, rules and representation.
              </p>
              <p className="mb-6">
                The capacity to successfully use language requires one to acquire a range of tools including phonology, morphology, syntax, semantics, and an extensive vocabulary.
                Language can be vocalized as in speech, or manual as in sign.
              </p>
              <p className="mb-6">
                The human language capacity is represented in the brain. Even though the human language capacity is finite, one can say and understand an infinite number of sentences, which is based on a recursive principle called generative grammar.
              </p>
              <p className="text-neutral-400 italic text-base mt-8">
                (Try highlighting any text above to test the LingoNote extension features)
              </p>
            </div>
          </div>
        </section>
        
        {/* Installation Instructions */}
        <section className="max-w-3xl mx-auto mt-32">
          <h2 className="text-2xl font-bold mb-8">How to Install</h2>
          <div className="space-y-4">
            {[
              "Download the extension ZIP file using the button above.",
              "Unzip the file to a folder named 'lingonote-extension'.",
              "Open Chrome and navigate to chrome://extensions.",
              "Enable 'Developer mode' in the top right corner.",
              "Click 'Load unpacked' and select the 'lingonote-extension' folder."
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-4 p-4 bg-white rounded-lg border border-neutral-100">
                <div className="w-6 h-6 rounded-full bg-neutral-900 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
                  {i + 1}
                </div>
                <p className="text-neutral-700">{step}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="bg-neutral-900 text-neutral-400 py-12 text-center">
        <p>© 2024 LingoNote. Open Source & Privacy Focused.</p>
      </footer>
    </div>
  );
}
