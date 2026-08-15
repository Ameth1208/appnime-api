import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { AuthController } from './auth.controller';
import { TokenService } from './token.service';
import { CreateAuthSessionUseCase } from './application/use-cases/create-auth-session.use-case';
import { LoginUserUseCase } from './application/use-cases/login-user.use-case';
import { LogoutUseCase } from './application/use-cases/logout.use-case';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case';
import { RegisterUserUseCase } from './application/use-cases/register-user.use-case';

@Global()
@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [JwtAuthGuard, TokenService, RegisterUserUseCase, CreateAuthSessionUseCase, LoginUserUseCase, RefreshSessionUseCase, LogoutUseCase],
  exports: [JwtAuthGuard, TokenService, CreateAuthSessionUseCase, JwtModule],
})
export class AuthModule {}
