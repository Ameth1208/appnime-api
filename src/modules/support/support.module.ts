import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [AccountsModule, RealtimeModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
