import { PLAYER_COLONY } from '@ant/shared';
import type { BubbleView } from './chatter';

/** Gap between the ant's centre and the bubble's tail, CSS px. */
const LIFT = 14;

/**
 * Speech bubbles over the canvas: plain DOM, one element per live line, keyed by line id so
 * a bubble keeps its pop-in animation while it follows its ant.
 */
export class SpeechBubbles {
  private readonly root = document.createElement('div');
  private readonly live = new Map<number, HTMLElement>();

  constructor(host: HTMLElement) {
    this.root.className = 'ant-chatter';
    this.root.setAttribute('aria-hidden', 'true');
    host.append(this.root);
  }

  update(bubbles: readonly BubbleView[]): void {
    const seen = new Set<number>();
    for (const b of bubbles) {
      seen.add(b.id);
      let el = this.live.get(b.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'ant-bubble';
        el.classList.toggle('rival', b.colony !== PLAYER_COLONY);
        el.textContent = b.text;
        this.root.append(el);
        this.live.set(b.id, el);
      }
      el.style.left = `${Math.round(b.x)}px`;
      el.style.top = `${Math.round(b.y - LIFT)}px`;
    }
    for (const [id, el] of this.live) {
      if (seen.has(id)) continue;
      el.remove();
      this.live.delete(id);
    }
  }
}
