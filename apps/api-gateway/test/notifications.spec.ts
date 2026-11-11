import { recipientIdsForRole, type CaregiverLink } from '../src/access/access';
import { toNotificationView } from '../src/notifications/notifications.service';

const link = (patch: Partial<CaregiverLink>): CaregiverLink => ({
  caregiverId: 'marie',
  seniorId: 'senior-001',
  relationType: 'FAMILY',
  consentStatus: 'GRANTED',
  revokedAt: null,
  ...patch,
});

describe('destinataires d\'une notification adressée à un rôle (ADR 0008)', () => {
  it('les personnes du rôle avec une relation consentie et active', () => {
    const links = [link({}), link({ caregiverId: 'paul' }), link({ caregiverId: 'dr-martin', relationType: 'MEDICAL' })];
    expect(recipientIdsForRole('FAMILY', links)).toEqual(['marie', 'paul']);
    expect(recipientIdsForRole('MEDICAL', links)).toEqual(['dr-martin']);
  });

  it('pas de notification sans consentement, ou après révocation', () => {
    expect(recipientIdsForRole('FAMILY', [link({ consentStatus: 'PENDING' })])).toEqual([]);
    expect(recipientIdsForRole('FAMILY', [link({ consentStatus: 'REVOKED' })])).toEqual([]);
    expect(recipientIdsForRole('FAMILY', [link({ revokedAt: new Date() })])).toEqual([]);
  });
});

describe('vue d\'une notification', () => {
  it('expose le texte, la priorité et l\'état de lecture', () => {
    const view = toNotificationView({
      id: 'n1',
      eventId: 'e1',
      recipientId: 'marie',
      seniorId: 'senior-001',
      alertId: 'alert-1',
      sensorId: null,
      priority: 'URGENT',
      severity: 'CRITICAL',
      reason: 'FALL_DETECTED',
      escalationCause: 'NO_RECOVERY',
      title: 'Chute : aucun signe de relèvement',
      message: '…',
      createdAt: new Date('2026-01-15T14:38:09.000Z'),
      readAt: null,
    });
    expect(view).toEqual({
      notificationId: 'n1',
      seniorId: 'senior-001',
      alertId: 'alert-1',
      sensorId: null,
      priority: 'URGENT',
      severity: 'CRITICAL',
      reason: 'FALL_DETECTED',
      title: 'Chute : aucun signe de relèvement',
      message: '…',
      createdAt: '2026-01-15T14:38:09.000Z',
      readAt: null,
    });
  });
});
