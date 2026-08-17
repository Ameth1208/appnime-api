import { Injectable, UnauthorizedException } from '@nestjs/common';
import { verify } from 'argon2';
import { PrismaService } from '../../../../common/database/prisma.service';
import { LoginInput } from '../../auth.schemas';
import { CreateAuthSessionUseCase } from './create-auth-session.use-case';

@Injectable()
export class LoginAdminUseCase {
  constructor(private readonly prisma: PrismaService, private readonly sessions: CreateAuthSessionUseCase) {}
  async execute(input: LoginInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    const isAdminActive = user?.isAdmin === true && user.status === 'ACTIVE';
    if (!user || !isAdminActive || !(await verify(user.passwordHash, input.password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas o acceso restringido' });
    }
    const tokens = await this.sessions.execute(user);
    return { ...tokens, user: { id: user.id, email: user.email, displayName: user.displayName, isAdmin: true } };
  }
}
