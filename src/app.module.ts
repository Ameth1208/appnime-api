import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './common/config/env.schema';
import { DatabaseModule } from './common/database/database.module';
import { StorageModule } from './common/storage/storage.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { ActivationCodesModule } from './modules/activation-codes/activation-codes.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { DeviceLinksModule } from './modules/device-links/device-links.module';
import { DevicesModule } from './modules/devices/devices.module';
import { HealthModule } from './modules/health/health.module';
import { HistoryModule } from './modules/history/history.module';
import { LicensingModule } from './modules/licensing/licensing.module';
import { MembersModule } from './modules/members/members.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PlansModule } from './modules/plans/plans.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { ReleasesModule } from './modules/releases/releases.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SupportModule } from './modules/support/support.module';
import { UsageSessionsModule } from './modules/usage-sessions/usage-sessions.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    DatabaseModule,
    StorageModule,
    AuthModule,
    UsersModule,
    AccountsModule,
    PlansModule,
    SubscriptionsModule,
    PaymentsModule,
    DevicesModule,
    UsageSessionsModule,
    LicensingModule,
    MembersModule,
    ActivationCodesModule,
    DeviceLinksModule,
    HistoryModule,
    ReleasesModule,
    SupportModule,
    RealtimeModule,
    AdminModule,
    HealthModule,
  ],
})
export class AppModule {}
