import { Module } from '@nestjs/common';
import { ActivationCodesModule } from '../activation-codes/activation-codes.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceLinksModule } from '../device-links/device-links.module';
import { MembersModule } from '../members/members.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';

@Module({
  imports: [AuthModule, PaymentsModule, ActivationCodesModule, RealtimeModule, MembersModule, DeviceLinksModule],
  controllers: [AdminController],
  providers: [AdminGuard],
  exports: [AdminGuard],
})
export class AdminModule {}
