import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AcquireUsageSessionUseCase } from './application/use-cases/acquire-usage-session.use-case';
import { HeartbeatUsageSessionUseCase } from './application/use-cases/heartbeat-usage-session.use-case';
import { ReleaseUsageSessionUseCase } from './application/use-cases/release-usage-session.use-case';
import { acquireUsageSchema, heartbeatUsageSchema, releaseUsageSchema } from './usage-session.schemas';

@Controller('v1/usage-sessions')
@UseGuards(JwtAuthGuard)
export class UsageSessionsController {
  constructor(
    private readonly acquire: AcquireUsageSessionUseCase,
    private readonly heartbeat: HeartbeatUsageSessionUseCase,
    private readonly release: ReleaseUsageSessionUseCase,
  ) {}
  @Post('acquire') acquireSession(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(acquireUsageSchema)) body: { deviceId: string }) { return this.acquire.execute(user.sub, body.deviceId); }
  @Post('heartbeat') heartbeatSession(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(heartbeatUsageSchema)) body: { usageSessionId: string }) { return this.heartbeat.execute(user.sub, body.usageSessionId); }
  @Post('release') releaseSession(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(releaseUsageSchema)) body: { usageSessionId: string }) { return this.release.execute(user.sub, body.usageSessionId); }
}
