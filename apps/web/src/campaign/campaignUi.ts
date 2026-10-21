import type { Container } from 'pixi.js';
import { PLAYER_COLONY } from '@ant/shared';
import type { CampaignAction, CampaignSnapshot, SimConfig, Snapshot } from '@ant/shared';
import { h } from '../ui/dom';
import { FloorLayer, FootstepLayer } from './layers';
import { MapView, patchName } from './mapView';
import './campaign.css';

export interface CampaignUiOptions {
  send(action: CampaignAction): void;
  toast(text: string): void;
  /** The map pauses the game while open. */
  setPaused(paused: boolean): void;
  /** Campaign won or lost. */
  onOver(won: boolean, title: string, text: string): void;
}

/**
 * Everything campaign-specific in the web app: the HUD strip (patches owned, house meter, Map
 * and Mating flight buttons), the yard map overlay, the tiled floor and human feet in house
 * rooms, and toasts for campaign events. Inactive (hidden) outside campaign games.
 */
export class CampaignUi {
  private hud = h('div', { id: 'campaign-hud', hidden: true });
  private progress = h('span', { class: 'chud-progress' });
  private mapBtn = h('button', { type: 'button', id: 'campaign-map-btn' }, 'Map');
  private flightBtn = h('button', { type: 'button', id: 'campaign-flight', hidden: true });
  private map: MapView;
  private feet: FootstepLayer | null = null;
  private info: CampaignSnapshot | null = null;
  private over = false;
  private warnedFeet = false;

  constructor(private opts: CampaignUiOptions) {
    this.hud.append(h('div', { class: 'bar' }, this.progress, this.mapBtn, this.flightBtn));
    document.body.append(this.hud);
    this.mapBtn.addEventListener('click', () => this.openMap());
    this.flightBtn.addEventListener('click', () => this.flight());
    this.map = new MapView({
      onEnter: (patch) => {
        if (patch !== this.info?.active) opts.send({ type: 'enterPatch', patch });
        this.closeMap();
      },
      onFlight: () => this.flight(),
      onClose: () => this.closeMap(),
    });
  }

  get active(): boolean {
    return this.info !== null;
  }

  get mapOpen(): boolean {
    return this.map.isOpen;
  }

  get state(): CampaignSnapshot | null {
    return this.info;
  }

  /** A new scene was built (`ready`): campaign games pass their overview, others undefined. */
  attach(world: Container, config: SimConfig, campaign: CampaignSnapshot | undefined): void {
    this.info = campaign ?? null;
    this.hud.hidden = !campaign;
    document.body.classList.toggle('in-campaign', !!campaign);
    this.feet = null;
    if (!campaign) {
      this.map.close();
      this.over = false;
      return;
    }
    this.over = campaign.outcome !== '';
    const patch = campaign.patches[campaign.active];
    if (patch?.kind === 'room') {
      new FloorLayer(world, config.worldSize);
      this.feet = new FootstepLayer(world);
    }
    this.sync();
  }

  onSnapshot(s: Snapshot): void {
    if (!this.info) return;
    if (s.campaign) {
      this.info = s.campaign;
      this.sync();
    }
    this.map.update(this.info, s.weather);
    this.feet?.update(s.footsteps);
    for (const ev of s.events) this.onEvent(ev, s);
  }

  openMap(): void {
    if (!this.info || this.map.isOpen) return;
    this.opts.setPaused(true);
    this.map.open();
  }

  closeMap(): void {
    if (!this.map.isOpen) return;
    this.map.close();
    if (!this.over) this.opts.setPaused(false);
  }

  private flight(): void {
    const c = this.info;
    if (!c || c.breeders < c.flightMin || this.over) return;
    this.opts.send({ type: 'matingFlight' });
  }

  private sync(): void {
    const c = this.info!;
    const meter = Math.round(c.infestation * 100);
    this.progress.textContent = `Patches ${c.owned}/${c.patches.length} · house ${meter}%`;
    this.progress.title = `Black colonies in ${c.owned} patches, red in ${c.redOwned}. House infestation ${meter}%.`;
    const ready = c.breeders >= c.flightMin && c.outcome === '';
    this.flightBtn.hidden = !ready;
    this.flightBtn.textContent = `Fly (${c.breeders})`;
    this.flightBtn.setAttribute('aria-label', `Mating flight: ${c.breeders} breeders`);
  }

  private name(id: number): string {
    const p = this.info?.patches[id];
    return p ? patchName(p) : 'a patch';
  }

  private onEvent(ev: Snapshot['events'][number], s: Snapshot): void {
    const toast = (text: string): void => this.opts.toast(text);
    switch (ev.type) {
      case 'matingFlight':
        if (ev.colony === PLAYER_COLONY) {
          toast(
            ev.founded.length
              ? `Mating flight! ${ev.breeders} breeders founded ${ev.founded.length} new ${ev.founded.length === 1 ? 'colony' : 'colonies'}`
              : `Mating flight: ${ev.breeders} breeders flew, but no new colony took hold`,
          );
        } else if (ev.founded.length) {
          toast(
            `Red queens founded ${ev.founded.length} new red ${ev.founded.length === 1 ? 'colony' : 'colonies'}`,
          );
        }
        break;
      case 'colonyDestroyed':
        toast(
          ev.colony === PLAYER_COLONY
            ? `Your colony in ${this.name(ev.patch)} has died out`
            : `The red colony in ${this.name(ev.patch)} was wiped out`,
        );
        break;
      case 'patchEntered':
        toast(`Entered ${this.name(ev.patch)}`);
        break;
      case 'season':
        toast(`Season ${ev.season + 1} begins — mating season!`);
        break;
      case 'footstepWarning':
        if (!this.warnedFeet) {
          this.warnedFeet = true;
          toast('Humans! Get your ants out from under the shadow');
        }
        break;
      case 'campaignOver': {
        this.over = true;
        this.map.close();
        const c = this.info!;
        const minutes = Math.round(s.tick / 20 / 60);
        this.opts.onOver(
          ev.won,
          ev.won ? 'Victory!' : 'Defeat',
          ev.won
            ? `The humans have moved out. The house and yard are yours.\nBlack colonies in ${c.owned} of ${c.patches.length} patches.`
            : `Your last colony is gone. The red ants hold ${c.redOwned} patches.\n${minutes} min in this patch.`,
        );
        break;
      }
    }
  }
}
