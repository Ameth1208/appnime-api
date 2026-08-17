import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { LikesController } from './likes.controller';
import { LikesService } from './likes.service';

@Module({
  imports: [RealtimeModule],
  controllers: [LikesController],
  providers: [LikesService],
})
export class LikesModule {}
