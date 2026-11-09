import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Role } from '@project/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { canAccessSenior, grantedSeniorIds, hasCapability, type AccessContext, type Capability } from './access';

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Charge les droits de l'appelant à chaque requête : une révocation prend effet immédiatement. */
  async contextFor(personId: string): Promise<AccessContext> {
    const person = await this.prisma.person.findUnique({
      where: { id: personId },
      include: { seniorProfile: true, caringRelationships: true },
    });
    if (!person) throw new NotFoundException('Compte introuvable');
    const role = person.role as Role;
    return {
      personId: person.id,
      role,
      ownSeniorId: person.seniorProfile?.id ?? null,
      grantedSeniorIds: grantedSeniorIds(role, person.caringRelationships),
    };
  }

  /** 403 si l'appelant n'a pas de relation consentie avec ce senior (ou n'est pas ce senior). */
  async assertCanAccess(personId: string, seniorId: string): Promise<AccessContext> {
    const ctx = await this.contextFor(personId);
    if (!canAccessSenior(ctx, seniorId)) {
      throw new ForbiddenException("Pas d'accès à ce senior (rôle ou relation consentie)");
    }
    return ctx;
  }

  assertCapability(ctx: AccessContext, capability: keyof typeof Capability): void {
    if (!hasCapability(ctx.role, capability)) {
      throw new ForbiddenException(`Action réservée aux rôles autorisés (${capability})`);
    }
  }
}
