import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AcceptInvitationUseCase } from './application/use-cases/accept-invitation.use-case';
import { InviteMemberUseCase } from './application/use-cases/invite-member.use-case';
import { ListMembersUseCase } from './application/use-cases/list-members.use-case';
import { RemoveMemberUseCase } from './application/use-cases/remove-member.use-case';
import { acceptInvitationSchema, inviteMemberSchema, InviteMemberInput } from './member.schemas';

@Controller('v1/account/members')
@UseGuards(JwtAuthGuard)
export class MembersController {
  constructor(
    private readonly inviteMember: InviteMemberUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
    private readonly removeMember: RemoveMemberUseCase,
    private readonly listMembers: ListMembersUseCase,
  ) {}
  @Get() list(@CurrentUser() user: AuthPrincipal) { return this.listMembers.execute(user.sub); }
  @Post('invite') invite(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(inviteMemberSchema)) body: InviteMemberInput) { return this.inviteMember.execute(user.sub, body.email); }
  @Post('accept') accept(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(acceptInvitationSchema)) body: { token: string }) { return this.acceptInvitation.execute(user.sub, body.token); }
  @Delete(':userId') remove(@CurrentUser() user: AuthPrincipal, @Param('userId') userId: string) { return this.removeMember.execute(user.sub, userId); }
}
