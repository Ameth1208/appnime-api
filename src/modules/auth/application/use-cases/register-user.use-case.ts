import { ConflictException, Injectable } from '@nestjs/common';
import { hash } from 'argon2';
import { PrismaService } from '../../../../common/database/prisma.service';
import { RegisterInput } from '../../auth.schemas';

@Injectable()
export class RegisterUserUseCase {
  constructor(private readonly prisma: PrismaService) {}
  async execute(input: RegisterInput) {
    if (await this.prisma.user.findUnique({ where: { email: input.email } })) {
      throw new ConflictException({ code: 'EMAIL_IN_USE' });
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: input.email, displayName: input.displayName, passwordHash: await hash(input.password) },
      });
      const account = await tx.account.create({ data: { ownerUserId: user.id } });
      await tx.accountMember.create({
        data: { accountId: account.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
      });
      return { id: user.id, email: user.email, displayName: user.displayName, accountId: account.id };
    });
  }
}
