import { Module } from '@nestjs/common';
import { ActivationCodesModule } from '../activation-codes/activation-codes.module';
import { AuthModule } from '../auth/auth.module';
import { DeviceLinksModule } from '../device-links/device-links.module';
import { MembersModule } from '../members/members.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminController } from './admin.controller';
import { AdminGuard, SuperAdminGuard } from './admin.guard';

@Module({
  imports: [AuthModule, PaymentsModule, ActivationCodesModule, RealtimeModule, MembersModule, DeviceLinksModule, CatalogModule],
  controllers: [AdminController],
  providers: [AdminGuard, SuperAdminGuard],
  exports: [AdminGuard, SuperAdminGuard],
})
export class AdminModule {}
