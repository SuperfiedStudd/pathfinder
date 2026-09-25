// The overlay lives inside the widget root (data-pf-widget) so the extractor
// never reports it. It is a fixed, click-through layer with one highlight
// box and one tooltip, repositioned on scroll and resize.
export class Overlay {
  private layer: HTMLDivElement;
  private box: HTMLDivElement;
  private tip: HTMLDivElement;
  private target: Element | null = null;
  private raf = 0;
  private onMove: () => void;

  constructor(root: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "pf-overlay-layer";
    this.box = document.createElement("div");
    this.box.className = "pf-highlight-box";
    this.tip = document.createElement("div");
    this.tip.className = "pf-tooltip";
    this.layer.appendChild(this.box);
    this.layer.appendChild(this.tip);
    root.appendChild(this.layer);
    this.layer.style.display = "none";

    this.onMove = () => this.schedule();
    window.addEventListener("scroll", this.onMove, true);
    window.addEventListener("resize", this.onMove);
  }

  show(target: Element, message: string): void {
    this.target = target;
    this.tip.textContent = message;
    this.layer.style.display = "block";
    this.box.classList.remove("pf-pulse");
    // restart the pulse animation
    void this.box.offsetWidth;
    this.box.classList.add("pf-pulse");
    this.schedule();
  }

  clear(): void {
    this.target = null;
    this.layer.style.display = "none";
  }

  current(): Element | null {
    return this.target;
  }

  destroy(): void {
    window.removeEventListener("scroll", this.onMove, true);
    window.removeEventListener("resize", this.onMove);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.layer.remove();
  }

  private schedule(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(() => this.reposition());
  }

  private reposition(): void {
    if (!this.target || !this.target.isConnected) {
      if (this.target && !this.target.isConnected) this.clear();
      return;
    }
    const rect = this.target.getBoundingClientRect();
    const pad = 6;
    this.box.style.left = `${rect.left - pad}px`;
    this.box.style.top = `${rect.top - pad}px`;
    this.box.style.width = `${rect.width + pad * 2}px`;
    this.box.style.height = `${rect.height + pad * 2}px`;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const tipWidth = Math.min(300, vw - 24);
    this.tip.style.maxWidth = `${tipWidth}px`;
    const tipRect = this.tip.getBoundingClientRect();
    let top = rect.bottom + pad + 10;
    if (top + tipRect.height > vh - 12) top = Math.max(12, rect.top - pad - tipRect.height - 10);
    let left = rect.left - pad;
    if (left + tipRect.width > vw - 12) left = Math.max(12, vw - 12 - tipRect.width);
    this.tip.style.left = `${left}px`;
    this.tip.style.top = `${top}px`;
  }
}
