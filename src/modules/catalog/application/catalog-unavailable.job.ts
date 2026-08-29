import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UnavailableCatalogService } from './catalog-unavailable.service';

/// Cada cuánto el job revisa si hay títulos programados para re-verificación
/// (30 días). El intervalo de escaneo es corto; el "cada 30 días" lo gobierna
/// `nextCheckAt` en la tabla.
const SCAN_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

@Injectable()
export class UnavailableCatalogJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnavailableCatalogJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly service: UnavailableCatalogService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('UNAVAILABLE_REVALIDATE') === 'off') return;
    // Pequeño delay para no competir con el arranque del resto.
    this.timer = setInterval(() => {
      void this.run().catch((err) =>
        this.logger.warn(`job de re-verificación falló: ${String(err).slice(0, 120)}`),
      );
    }, SCAN_INTERVAL_MS);
    // Despuntar la primera corrida al arranque.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<{ checked: number; resolved: number; stillUnavailable: number }> {
    const res = await this.service.recheckDue();
    this.logger.log(
      `re-verificación de catálogo indisponible: checked=${res.checked} resolved=${res.resolved} still=${res.stillUnavailable}`,
    );
    return res;
  }
}
