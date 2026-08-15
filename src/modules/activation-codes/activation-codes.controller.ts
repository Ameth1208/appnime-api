import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { RedeemActivationCodeUseCase } from './application/use-cases/redeem-activation-code.use-case';
import { redeemCodeSchema } from './activation-code.schemas';

@Controller('v1/activation-codes')
@UseGuards(JwtAuthGuard)
export class ActivationCodesController {
  constructor(private readonly redeemCode: RedeemActivationCodeUseCase) {}
  @Post('redeem') redeem(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(redeemCodeSchema)) body: { code: string }) { return this.redeemCode.execute(user.sub, body.code); }
}
