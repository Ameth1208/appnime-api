import { Injectable } from '@nestjs/common';
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case';
import { RegisterDeviceInput } from './device.schemas';

@Injectable()
export class DevicesService {
  constructor(private readonly registerDevice: RegisterDeviceUseCase) {}
  register(userId: string, input: RegisterDeviceInput) { return this.registerDevice.execute(userId, input); }
}
