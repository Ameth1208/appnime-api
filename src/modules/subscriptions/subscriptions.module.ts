import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { SubscriptionGrantService } from './application/subscription-grant.service';
import { SubscriptionPolicyService } from './subscription-policy.service';
import { SubscriptionsController } from './subscriptions.controller';

@Module({
  imports: [AccountsModule],
  providers: [SubscriptionPolicyService, SubscriptionGrantService],
  controllers: [SubscriptionsController],
  exports: [SubscriptionPolicyService, SubscriptionGrantService],
})
export class SubscriptionsModule {}
