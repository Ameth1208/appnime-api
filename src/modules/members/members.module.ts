import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AcceptInvitationUseCase } from './application/use-cases/accept-invitation.use-case';
import { InviteMemberUseCase } from './application/use-cases/invite-member.use-case';
import { ListMembersUseCase } from './application/use-cases/list-members.use-case';
import { RemoveMemberUseCase } from './application/use-cases/remove-member.use-case';
import { MembersController } from './members.controller';

@Module({
  imports: [AccountsModule, SubscriptionsModule, RealtimeModule],
  controllers: [MembersController],
  providers: [InviteMemberUseCase, AcceptInvitationUseCase, RemoveMemberUseCase, ListMembersUseCase],
})
export class MembersModule {}
