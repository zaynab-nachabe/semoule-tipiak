// Temps réel (docs/contrat-api.md §4) : socket.io. À la connexion, le jeton est vérifié et le client
// rejoint une salle par senior accessible. Chaque message est projeté selon le rôle du destinataire.

import { Logger } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { PreConfirmationRequestedPayload, RealtimeMessageByType, Role } from '@project/shared-types';
import type { Server, Socket } from 'socket.io';
import { accessibleSeniorIds } from '../access/access';
import { AccessService } from '../access/access.service';
import type { AlertChange } from '../alerts/alerts.service';
import { isPushedTo, toAlertView } from '../alerts/alert-view';
import { AuthService } from '../auth/auth.service';

interface ClientData {
  personId: string;
  role: Role;
}

const room = (seniorId: string) => `senior:${seniorId}`;

@WebSocketGateway({ cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const token: unknown = client.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('jeton manquant');
      const user = await this.auth.verify(token);
      const ctx = await this.access.contextFor(user.personId);
      const data: ClientData = { personId: user.personId, role: user.role };
      client.data = data;
      const seniors = accessibleSeniorIds(ctx);
      await client.join(seniors.map(room));
      client.emit('ready', { seniors });
    } catch (error) {
      this.logger.warn(`connexion temps réel refusée : ${error instanceof Error ? error.message : String(error)}`);
      client.disconnect(true);
    }
  }

  /** Pousse un changement d'alerte à chaque client autorisé, projeté selon son rôle. */
  async publishAlertChange(change: AlertChange): Promise<void> {
    const sockets = await this.server.in(room(change.next.seniorId)).fetchSockets();
    for (const socket of sockets) {
      const { role } = socket.data as ClientData;
      if (!isPushedTo(change.next, role)) continue;
      // Pour la famille et le médical, l'alerte « apparaît » au moment de son escalade.
      const firstTimeVisible = change.change === 'created' || (change.previous !== null && !isPushedTo(change.previous, role));
      const type: keyof RealtimeMessageByType = firstTimeVisible ? 'alert.created' : 'alert.updated';
      socket.emit(type, toAlertView(change.next, role));
    }
  }

  /** « Tout va bien ? » : uniquement pour le senior concerné. */
  async publishPreConfirmation(seniorId: string, payload: PreConfirmationRequestedPayload): Promise<void> {
    const message: RealtimeMessageByType['preconfirmation.requested'] = {
      seniorId,
      alertId: payload.alertId,
      reason: payload.reason,
      expiresAt: payload.expiresAt,
    };
    const sockets = await this.server.in(room(seniorId)).fetchSockets();
    for (const socket of sockets) {
      if ((socket.data as ClientData).role === 'SENIOR') socket.emit('preconfirmation.requested', message);
    }
  }
}
