import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DevicesModule } from '../devices/devices.module';
import { ApproveDeviceLinkUseCase } from './application/use-cases/approve-device-link.use-case';
import { AdminDeviceLinkUseCase } from './application/use-cases/admin-device-link.use-case';
import { ClaimDeviceLinkUseCase } from './application/use-cases/claim-device-link.use-case';
import { RequestDeviceLinkUseCase } from './application/use-cases/request-device-link.use-case';
import { DeviceLinksController } from './device-links.controller';

@Module({
  imports: [AuthModule, DevicesModule],
  controllers: [DeviceLinksController],
  providers: [RequestDeviceLinkUseCase, ApproveDeviceLinkUseCase, ClaimDeviceLinkUseCase, AdminDeviceLinkUseCase],
  exports: [AdminDeviceLinkUseCase],
})
export class DeviceLinksModule {}
