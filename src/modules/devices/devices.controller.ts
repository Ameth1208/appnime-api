import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { ListDevicesUseCase } from './application/use-cases/list-devices.use-case';
import { RegisterDeviceUseCase } from './application/use-cases/register-device.use-case';
import { RevokeDeviceUseCase } from './application/use-cases/revoke-device.use-case';
import { registerDeviceSchema, RegisterDeviceInput } from './device.schemas';

@Controller('v1/devices')
@UseGuards(JwtAuthGuard)
export class DevicesController {
  constructor(
    private readonly registerDevice: RegisterDeviceUseCase,
    private readonly listDevices: ListDevicesUseCase,
    private readonly revokeDevice: RevokeDeviceUseCase,
  ) {}
  @Post() register(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(registerDeviceSchema)) body: RegisterDeviceInput) { return this.registerDevice.execute(user.sub, body); }
  @Get() list(@CurrentUser() user: AuthPrincipal) { return this.listDevices.execute(user.sub); }
  @Delete(':id') revoke(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) { return this.revokeDevice.execute(user.sub, id); }
}
