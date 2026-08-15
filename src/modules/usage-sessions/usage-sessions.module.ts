import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AcquireUsageSessionUseCase } from './application/use-cases/acquire-usage-session.use-case';
import { HeartbeatUsageSessionUseCase } from './application/use-cases/heartbeat-usage-session.use-case';
import { ReleaseUsageSessionUseCase } from './application/use-cases/release-usage-session.use-case';
import { UsageSessionsController } from './usage-sessions.controller';

@Module({
  imports: [SubscriptionsModule, RealtimeModule],
  controllers: [UsageSessionsController],
  providers: [AcquireUsageSessionUseCase, HeartbeatUsageSessionUseCase, ReleaseUsageSessionUseCase],
})
export class UsageSessionsModule {}
