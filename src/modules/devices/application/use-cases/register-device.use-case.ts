import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../common/database/prisma.service';
import { AccountAccessService } from '../../../accounts/account-access.service';
import { SubscriptionPolicyService } from '../../../subscriptions/subscription-policy.service';
import { DeviceFingerprintService } from '../../device-fingerprint.service';
import { RegisterDeviceInput } from '../../device.schemas';

@Injectable()
export class RegisterDeviceUseCase {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccountAccessService,
    private readonly policy: SubscriptionPolicyService,
    private readonly fingerprint: DeviceFingerprintService,
  ) {}

  async execute(userId: string, input: RegisterDeviceInput) {
    const membership = await this.access.activeMembership(userId);
    // El registro del dispositivo NO debe depender de la suscripción: si la
    // cuenta está inactiva o expirada, igual registramos el equipo para que
    // su identidad sea estable (evita prompts de "nuevo dispositivo" en cada
    // login). La suscripción se valida al emitir leases y UsageSessions.
    const entitlement = await this.policy.resolve(membership.accountId);
    const fingerprintHash = this.fingerprint.hash(input.fingerprint);
    const macHash = this.fingerprint.hash(input.mac);

    const existing = await this.prisma.device.findUnique({
      where: { accountId_installationId: { accountId: membership.accountId, installationId: input.installationId } },
    });
    if (existing) {
      if (existing.userId !== userId) throw new BadRequestException({ code: 'DEVICE_BELONGS_TO_ANOTHER_MEMBER' });
      return this.prisma.device.update({
        where: { id: existing.id },
        data: this.deviceUpdate(input),
      });
    }

    // Mismo equipo físico: si la huella de hardware coincide con un registro
    // previo (aunque esté REVOKED o su installationId cambió tras una
    // reinstalación), se reactiva ESA fila en lugar de crear una nueva. Así
    // reinstalar la app no consume slots ni choca con límites/ventanas.
    const hardwareMatchers = [
      ...(fingerprintHash ? [{ deviceFingerprintHash: fingerprintHash }] : []),
      ...(macHash ? [{ macHash }] : []),
    ];
    if (hardwareMatchers.length) {
      const sameHardware = await this.prisma.device.findFirst({
        where: { accountId: membership.accountId, userId, OR: hardwareMatchers },
        orderBy: { lastSeenAt: 'desc' },
      });
      if (sameHardware) {
        return this.prisma.device.update({
          where: { id: sameHardware.id },
          data: {
            ...this.deviceUpdate(input),
            installationId: input.installationId,
            deviceFingerprintHash: fingerprintHash,
            macHash,
          },
        });
      }
    }
    // El límite SIEMPRE es el del plan del usuario (p.ej. Individual 3,
    // Family 5). Si la suscripción está inactiva usamos el último plan
    // conocido de la cuenta; solo si nunca tuvo plan aplicamos el fallback.
    let maxDevices = Number(process.env.DEVICE_FALLBACK_MAX ?? 5);
    if (entitlement.active) {
      maxDevices = entitlement.plan.maxDevicesPerUser;
    } else {
      const lastPlan = await this.prisma.subscription.findFirst({
        where: { accountId: membership.accountId },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      });
      if (lastPlan) maxDevices = lastPlan.plan.maxDevicesPerUser;
    }
    const activeCount = await this.prisma.device.count({ where: { userId, accountId: membership.accountId, status: 'ACTIVE' } });
    if (activeCount >= maxDevices) {
      // Reemplazo automático: liberar el dispositivo más viejo (por último
      // uso) para hacer sitio al nuevo, en vez de rechazar el registro.
      const oldest = await this.prisma.device.findFirst({
        where: { userId, accountId: membership.accountId, status: 'ACTIVE' },
        orderBy: { lastSeenAt: 'asc' },
      });
      if (!oldest) throw new BadRequestException({ code: 'USER_DEVICE_LIMIT_REACHED', maxDevices });
      await this.revokeDevice(oldest.id, membership.accountId, userId);
    }
    const maxChanges = entitlement.active
      ? entitlement.plan.maxDeviceChangesPerWindow
      : Number(process.env.DEVICE_FALLBACK_CHANGES ?? 5);
    const windowDays = entitlement.active
      ? entitlement.plan.deviceChangeWindowDays
      : 30;
    // Ventana anti-reemplazos masivos OPCIONAL (DEVICE_ENFORCE_CHANGE_WINDOW,
    // default false): con el auto-reemplazo del más viejo activo, bloquear el
    // registro deja al usuario fuera de la app sin beneficio real. Los
    // reemplazos automáticos nunca cuentan para esta ventana.
    if (String(process.env.DEVICE_ENFORCE_CHANGE_WINDOW ?? 'false') === 'true') {
      await this.enforceReplacementWindow(userId, membership.accountId, maxChanges, windowDays);
    }
    const device = await this.prisma.device.create({
      data: {
        accountId: membership.accountId,
        userId,
        installationId: input.installationId,
        platform: input.platform,
        brand: input.brand,
        model: input.model,
        deviceName: input.deviceName,
        architecture: input.architecture,
        osVersion: input.osVersion,
        appVersion: input.appVersion,
        deviceFingerprintHash: this.fingerprint.hash(input.fingerprint),
        macHash: this.fingerprint.hash(input.mac),
      },
    });
    await this.prisma.deviceChange.create({ data: { accountId: membership.accountId, userId, deviceId: device.id, action: 'REGISTERED' } });
    return device;
  }

  /// Revoca un dispositivo y sus sesiones (mismo efecto que quitarlo desde
  /// "Mis dispositivos"), registrando el cambio para la ventana de reemplazo.
  private async revokeDevice(deviceId: string, accountId: string, userId: string) {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.device.update({ where: { id: deviceId }, data: { status: 'REVOKED', revokedAt: now } }),
      this.prisma.session.updateMany({ where: { deviceId, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.usageSession.updateMany({ where: { deviceId, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: now } }),
      this.prisma.deviceChange.create({ data: { accountId, userId, deviceId, action: 'AUTO_REPLACED' } }),
    ]);
  }

  private deviceUpdate(input: RegisterDeviceInput) {
    return {
      status: 'ACTIVE' as const,
      revokedAt: null,
      lastSeenAt: new Date(),
      platform: input.platform,
      brand: input.brand,
      model: input.model,
      deviceName: input.deviceName,
      architecture: input.architecture,
      osVersion: input.osVersion,
      appVersion: input.appVersion,
      deviceFingerprintHash: this.fingerprint.hash(input.fingerprint),
      macHash: this.fingerprint.hash(input.mac),
    };
  }

  private async enforceReplacementWindow(userId: string, accountId: string, max: number, windowDays: number) {
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const changes = await this.prisma.deviceChange.count({ where: { userId, accountId, action: 'REVOKED', createdAt: { gte: since } } });
    if (changes >= max) throw new BadRequestException({ code: 'DEVICE_CHANGE_LIMIT_REACHED', maxChanges: max, windowDays });
  }
}
