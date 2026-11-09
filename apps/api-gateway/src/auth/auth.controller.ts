import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { LoginRequest, LoginResponse, MeView, UserSummary } from '@project/shared-types';
import { AuthGuard, CurrentUser } from './auth.guard';
import { AuthService, type AuthenticatedUser } from './auth.service';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Comptes proposés sur l'écran de connexion. */
  @Get('auth/users')
  users(): Promise<UserSummary[]> {
    return this.auth.listUsers();
  }

  @Post('auth/login')
  @HttpCode(200)
  login(@Body() body: Partial<LoginRequest> | undefined): Promise<LoginResponse> {
    if (!body || typeof body.email !== 'string' || body.email.trim() === '') {
      throw new BadRequestException('email attendu');
    }
    return this.auth.login(body.email.trim());
  }

  /** Jeton sans état : la déconnexion consiste à l'oublier côté application. */
  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  logout(): void {}

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeView> {
    return this.auth.me(user);
  }
}
