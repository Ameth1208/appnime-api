import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountAccessService } from './account-access.service';
@Module({ controllers: [AccountsController], providers: [AccountAccessService], exports: [AccountAccessService] })
export class AccountsModule {}
