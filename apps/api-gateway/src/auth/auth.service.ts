// Authentification par simple choix dans la liste des comptes (hors périmètre du sujet, pas de mot de passe).
// Un jeton JWT signé identifie ensuite l'appelant ; ses droits sont relus en base à chaque requête.

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { LoginResponse, MeView, Role, UserSummary } from '@project/shared-types';
import { accessibleSeniorIds } from '../access/access';
import { AccessService } from '../access/access.service';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedUser {
  readonly personId: string;
  readonly role: Role;
}

interface TokenPayload {
  sub: string;
  role: Role;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  async listUsers(): Promise<UserSummary[]> {
    const persons = await this.prisma.person.findMany({ orderBy: [{ role: 'asc' }, { fullName: 'asc' }] });
    return persons.map((p) => ({ email: p.email, fullName: p.fullName, role: p.role as Role }));
  }

  async login(email: string): Promise<LoginResponse> {
    const person = await this.prisma.person.findUnique({ where: { email } });
    if (!person) throw new UnauthorizedException('Compte inconnu');
    const payload: TokenPayload = { sub: person.id, role: person.role as Role };
    return {
      token: await this.jwt.signAsync(payload),
      user: { email: person.email, fullName: person.fullName, role: person.role as Role },
    };
  }

  /** Vérifie le jeton et que le compte existe toujours. */
  async verify(token: string): Promise<AuthenticatedUser> {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Jeton invalide ou expiré');
    }
    const person = await this.prisma.person.findUnique({ where: { id: payload.sub } });
    if (!person) throw new UnauthorizedException('Compte inconnu');
    return { personId: person.id, role: person.role as Role };
  }

  async me(user: AuthenticatedUser): Promise<MeView> {
    const person = await this.prisma.person.findUniqueOrThrow({ where: { id: user.personId } });
    const ctx = await this.access.contextFor(user.personId);
    const ids = accessibleSeniorIds(ctx);
    const seniors = await this.prisma.senior.findMany({ where: { id: { in: ids } }, include: { person: true } });
    return {
      personId: person.id,
      email: person.email,
      fullName: person.fullName,
      role: person.role as Role,
      seniors: seniors.map((s) => ({ seniorId: s.id, fullName: s.person.fullName })),
    };
  }
}
