export type CheckoutRequest = {
  accountId: string;
  planId: string;
  amountCents: number;
  currency: string;
  customerEmail: string;
  returnUrl: string;
};

export type CheckoutResult = { url: string; externalId: string };
export type VerifiedPaymentEvent = {
  externalId: string;
  reference: string;
  status: 'PAID' | 'FAILED' | 'REFUNDED' | 'CANCELLED';
  amountCents: number;
  currency: string;
  metadata?: Record<string, unknown>;
};

export abstract class PaymentProvider {
  abstract readonly kind: 'WOMPI' | 'MERCADO_PAGO' | 'STRIPE' | 'OTHER';
  abstract createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  abstract verifyWebhook(headers: Record<string, string | string[] | undefined>, body: unknown): Promise<VerifiedPaymentEvent>;
}
