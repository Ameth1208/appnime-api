import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ActivationCodesController } from './activation-codes.controller';
import { GenerateActivationCodesUseCase } from './application/use-cases/generate-activation-codes.use-case';
import { RedeemActivationCodeUseCase } from './application/use-cases/redeem-activation-code.use-case';

@Module({
  imports: [AccountsModule, SubscriptionsModule],
  controllers: [ActivationCodesController],
  providers: [GenerateActivationCodesUseCase, RedeemActivationCodeUseCase],
  exports: [GenerateActivationCodesUseCase],
})
export class ActivationCodesModule {}
