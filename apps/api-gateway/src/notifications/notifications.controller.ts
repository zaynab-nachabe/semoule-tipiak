import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { NotificationView, Paginated } from '@project/shared-types';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.service';
import { parsePage } from '../common/pagination';
import { NotificationsService } from './notifications.service';

/** Boîte de réception de l'appelant : il ne voit que ses propres notifications. */
@Controller('me/notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('unreadOnly') unreadOnly?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<Paginated<NotificationView>> {
    const request = parsePage(page, pageSize);
    const { items, total } = await this.notifications.list(user.personId, unreadOnly === 'true', request.page, request.pageSize);
    return { items, total, ...request };
  }

  @Post(':notificationId/read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthenticatedUser, @Param('notificationId') notificationId: string): Promise<NotificationView> {
    return this.notifications.markRead(user.personId, notificationId);
  }
}
