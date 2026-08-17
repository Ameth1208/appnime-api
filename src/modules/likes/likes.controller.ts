import { Body, Controller, Delete, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthPrincipal, CurrentUser } from '../../common/security/current-user.decorator';
import { JwtAuthGuard } from '../../common/security/jwt-auth.guard';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { LikesService } from './likes.service';
import { likeSchema, unlikeQuerySchema, LikeInput } from './likes.schemas';

@Controller('v1/likes')
@UseGuards(JwtAuthGuard)
export class LikesController {
  constructor(private readonly likes: LikesService) {}

  @Get()
  list(@CurrentUser() user: AuthPrincipal) {
    return this.likes.list(user.sub);
  }

  @Put()
  like(@CurrentUser() user: AuthPrincipal, @Body(new ZodValidationPipe(likeSchema)) body: LikeInput) {
    return this.likes.like(user.sub, body);
  }

  @Delete()
  unlike(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodValidationPipe(unlikeQuerySchema)) query: { sourceId: string; contentUrl: string },
  ) {
    return this.likes.unlike(user.sub, query.sourceId, query.contentUrl);
  }
}
