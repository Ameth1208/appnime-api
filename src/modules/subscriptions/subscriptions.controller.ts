import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { AccountAccessService } from '../accounts/account-access.service';
import { SubscriptionPolicyService } from './subscription-policy.service';

@Controller('v1/subscription')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly access: AccountAccessService, private readonly policy: SubscriptionPolicyService) {}
  @Get()
  async current(@CurrentUser() user: AuthPrincipal) {
    const membership = await this.access.activeMembership(user.sub);
    return this.policy.resolve(membership.accountId);
  }
}
