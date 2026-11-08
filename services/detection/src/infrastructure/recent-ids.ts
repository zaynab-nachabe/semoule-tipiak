// Mémoire bornée des derniers eventId reçus : en QoS 1 (« au moins une fois »), un message peut
// arriver en double. On ignore un eventId déjà traité (docs/topics-mqtt.md §4).

export class RecentIds {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = 10_000) {}

  /** Renvoie true si l'identifiant est nouveau (et le mémorise), false s'il a déjà été vu. */
  remember(id: string): boolean {
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const oldest = this.order.shift();
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
