import { h } from './dom';
import { TUTORIAL_STEPS, Tutorial, type TutorialObservation } from './tutorial';

/** The floating prompt card for the tutorial; the progression logic lives in `Tutorial`. */
export class TutorialPanel {
  readonly el = h('section', {
    id: 'tutorial',
    'aria-label': 'Tutorial',
    hidden: true,
  });
  private title = h('h2', {});
  private body = h('p', { role: 'status' });
  private count = h('span', { class: 'tut-count' });
  private next = h('button', { type: 'button', class: 'tut-next' }, 'Got it');
  private skip = h('button', { type: 'button', class: 'tut-skip' }, 'Skip tutorial');
  private tutorial: Tutorial | null = null;

  constructor(
    private touch: boolean,
    private onDone: () => void,
  ) {
    this.el.append(
      h('div', { class: 'tut-head' }, this.title, this.count),
      this.body,
      h('div', { class: 'tut-actions' }, this.skip, this.next),
    );
    document.body.append(this.el);
    // Sit just above the bottom HUD, whatever height it wraps to.
    new ResizeObserver(() => {
      const h = this.el.hidden ? 0 : this.el.getBoundingClientRect().height + 8;
      document.documentElement.style.setProperty('--tut-h', `${h}px`);
    }).observe(this.el);
    const hud = document.getElementById('hud');
    if (hud) {
      new ResizeObserver(() => {
        document.documentElement.style.setProperty(
          '--hud-h',
          `${hud.getBoundingClientRect().height}px`,
        );
      }).observe(hud);
    }
    this.skip.addEventListener('click', () => this.tutorial?.skip());
    this.next.addEventListener('click', () => this.tutorial?.advance());
  }

  get active(): boolean {
    return this.tutorial !== null && !this.tutorial.finished;
  }

  start(): void {
    const t = new Tutorial();
    this.tutorial = t;
    t.onChange = () => {
      if (t.finished) this.stop(true);
      else this.render();
    };
    this.render();
  }

  /** Remove the card; `completed` marks the tutorial as done (finished or skipped). */
  stop(completed = false): void {
    this.tutorial = null;
    this.el.hidden = true;
    if (completed) this.onDone();
  }

  observe(o: TutorialObservation): void {
    this.tutorial?.observe(o);
  }

  private render(): void {
    const t = this.tutorial;
    const step = t?.step;
    if (!t || !step) return;
    const last = t.index === TUTORIAL_STEPS.length - 1;
    this.title.textContent = step.text.title;
    this.body.textContent = this.touch ? step.text.touch : step.text.desktop;
    this.count.textContent = `${t.index + 1}/${TUTORIAL_STEPS.length}`;
    this.next.hidden = !last;
    this.skip.hidden = last;
    this.el.hidden = false;
  }
}
