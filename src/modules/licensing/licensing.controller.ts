import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { LeaseKeyService } from './lease-key.service';
import { LicensingService } from './licensing.service';

const leaseSchema = z.object({ deviceId: z.string().min(1) });

@Controller('v1/licensing')
export class LicensingController {
  constructor(private readonly licensing: LicensingService, private readonly keys: LeaseKeyService) {}
  @Get('public-key') key() { return this.keys.getPublicJwk(); }
  @UseGuards(JwtAuthGuard)
  @Post('lease')
  lease(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(leaseSchema)) body: { deviceId: string }) {
    return this.licensing.issue(user.sub, body.deviceId);
  }
}
