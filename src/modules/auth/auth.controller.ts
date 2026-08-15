import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';
import { loginSchema, LoginInput, refreshSchema, registerSchema, RegisterInput } from './auth.schemas';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly loginUser: LoginUserUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutUser: LogoutUseCase,
  ) {}
  @Post('register') register(@Body(new ZodValidationPipe(registerSchema)) body: RegisterInput) { return this.registerUser.execute(body); }
  @Post('login') login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) { return this.loginUser.execute(body); }
  @Post('refresh') refresh(@Body(new ZodValidationPipe(refreshSchema)) body: { refreshToken: string }) { return this.refreshSession.execute(body.refreshToken); }
  @UseGuards(JwtAuthGuard) @Post('logout') logout(@CurrentUser() user: AuthPrincipal) { return this.logoutUser.execute(user.sessionId); }
}
