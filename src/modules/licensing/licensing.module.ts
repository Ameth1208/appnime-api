import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { LeaseKeyService } from './lease-key.service';
import { LicensingController } from './licensing.controller';
import { LicensingService } from './licensing.service';

@Module({
  imports: [AccountsModule, SubscriptionsModule],
  providers: [LeaseKeyService, LicensingService],
  controllers: [LicensingController],
})
export class LicensingModule {}
