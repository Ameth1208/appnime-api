import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { ListDevicesUseCase } from './application/use-cases/list-devices.use-case';
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case';
import { RevokeDeviceUseCase } from './application/use-cases/revoke-device.use-case';

@Module({
  imports: [AccountsModule, SubscriptionsModule],
  controllers: [DevicesController],
  providers: [DeviceFingerprintService, RegisterDeviceUseCase, ListDevicesUseCase, RevokeDeviceUseCase, DevicesService],
  exports: [RegisterDeviceUseCase, DevicesService],
})
export class DevicesModule {}
