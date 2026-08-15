import { Module } from '@nestjs/common';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { ManualPaymentService } from './manual-payment.service';

@Module({ imports: [SubscriptionsModule], providers: [ManualPaymentService], exports: [ManualPaymentService] })
export class PaymentsModule {}
