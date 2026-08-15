import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { ApproveDeviceLinkUseCase } from './application/use-cases/approve-device-link.use-case';
import { ClaimDeviceLinkUseCase } from './application/use-cases/claim-device-link.use-case';
import { RequestDeviceLinkUseCase } from './application/use-cases/request-device-link.use-case';
import { approveDeviceLinkSchema, claimDeviceLinkSchema, requestDeviceLinkSchema, RequestDeviceLinkInput } from './device-link.schemas';

@Controller('v1/device-links')
export class DeviceLinksController {
  constructor(
    private readonly requestLink: RequestDeviceLinkUseCase,
    private readonly approveLink: ApproveDeviceLinkUseCase,
    private readonly claimLink: ClaimDeviceLinkUseCase,
  ) {}
  @Post('request') request(@Body(new ZodValidationPipe(requestDeviceLinkSchema)) body: RequestDeviceLinkInput) { return this.requestLink.execute(body); }
  @UseGuards(JwtAuthGuard) @Post('approve') approve(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(approveDeviceLinkSchema)) body: { code: string }) { return this.approveLink.execute(user.sub, body.code); }
  @Post('claim') claim(@Body(new ZodValidationPipe(claimDeviceLinkSchema)) body: { linkId: string; claimSecret: string }) { return this.claimLink.execute(body.linkId, body.claimSecret); }
}
