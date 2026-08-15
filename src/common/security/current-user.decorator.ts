import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export type AuthPrincipal = {
  sub: string;
  email: string;
  sessionId: string;
  deviceId?: string;
};

export const CurrentUser = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthPrincipal => context.switchToHttp().getRequest().user,
);
