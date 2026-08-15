import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verify } from 'argon2';
import { PrismaService } from '../../../../common/database/prisma.service';
import { LoginInput } from '../../auth.schemas';
import { CreateAuthSessionUseCase } from './create-auth-session.use-case';

@Injectable()
export class LoginUserUseCase {
  constructor(private readonly prisma: PrismaService, private readonly sessions: CreateAuthSessionUseCase) {}
  async execute(input: LoginInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user || user.status !== 'ACTIVE' || !(await verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    const tokens = await this.sessions.execute(user);
    return { ...tokens, user: { id: user.id, email: user.email, displayName: user.displayName } };
  }
}
