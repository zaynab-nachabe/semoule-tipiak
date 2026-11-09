// Mémoire bornée des derniers eventId reçus (QoS 1 peut livrer un message deux fois).

export class RecentIds {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = 10_000) {}

  /** true si l'identifiant est nouveau (et le mémorise), false s'il a déjà été vu. */
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
