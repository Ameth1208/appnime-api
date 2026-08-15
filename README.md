# AppNime Backend

Backend V1 para cuentas, suscripciones, activaciones, dispositivos, licencias offline, historial, soporte y actualizaciones de AppNime.

## Stack

- TypeScript + NestJS
- PostgreSQL + Prisma
- Zod como capa de validacion HTTP
- Scalar sobre OpenAPI
- Socket.IO para eventos en tiempo real
- Multer + Sharp para avatar/release uploads
- Storage intercambiable: filesystem local o S3-compatible (Cloudflare R2, S3, MinIO)
- JWT access + rotating refresh tokens
- Argon2 para passwords
- Ed25519 para leases offline firmados

## Reglas comerciales V1

### Individual

- 16.000 COP / mes (`INDIVIDUAL_MONTHLY`)
- 160.000 COP / anio (`INDIVIDUAL_YEARLY`)
- 1 persona
- 3 dispositivos registrados: pensado para TV + movil + PC
- 1 uso simultaneo

### Family

- 25.000 COP / mes (`FAMILY_MONTHLY`)
- 250.000 COP / anio (`FAMILY_YEARLY`)
- owner + 4 miembros
- 3 dispositivos registrados por persona (15 maximo si se ocupan los cinco perfiles)
- 1 uso simultaneo por persona (hasta 5 personas distintas simultaneamente)

Los dispositivos autorizados y las sesiones de uso son conceptos separados. Cambiar de TV a PC no elimina la TV; solo revoca la `UsageSession` previa. El ultimo dispositivo que adquiere uso gana.

## Acceso sin servidor

Una validacion exitosa entrega un lease Ed25519. La app debe intentar renovar el lease cada 6 horas. Un timeout, DNS error, 502 o 503 NO debe hacer logout. El lease conserva el corte comercial y agrega 72 horas de gracia offline despues de la validez comercial. La gracia de cobro configurada es 48 horas.

Un rechazo explicito del API (`BLOCKED`, `EXPIRED`, `DEVICE_REVOKED`) si debe bloquear el acceso. Un bloqueo administrativo no puede ser instantaneo contra un dispositivo completamente offline; se aplica al reconectar o al vencer su lease.

## Activaciones

Existen cuatro clases de codigo comercial:

- `TRIAL`: tiempo de prueba sin pasarela.
- `PREPAID`: venta por terceros sin checkout.
- `COMPLIMENTARY`: familiares, partners, soporte y promociones.
- `LIFETIME`: concesion permanente administrada.

Los codigos se guardan hasheados; el texto plano solo se devuelve al administrador al generar el lote.

## Vincular Android TV

1. TV llama `POST /api/v1/device-links/request` y recibe codigo corto + secreto de claim.
2. Usuario autenticado aprueba el codigo desde movil con `POST /api/v1/device-links/approve`.
3. Se valida el limite de 3 dispositivos de ESE usuario.
4. TV consulta `POST /api/v1/device-links/claim`.
5. Al aprobarse, recibe sus tokens y queda autenticada sin escribir email/password en el control remoto.

El codigo de TV es temporal y no concede una suscripcion. No debe confundirse con un activation code comercial.

## Endpoints principales

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

GET    /api/v1/me
POST   /api/v1/me/avatar
GET    /api/v1/account
GET    /api/v1/account/members
POST   /api/v1/account/members/invite
POST   /api/v1/account/members/accept
DELETE /api/v1/account/members/:userId

GET    /api/v1/plans
GET    /api/v1/subscription
POST   /api/v1/activation-codes/redeem

POST   /api/v1/devices
GET    /api/v1/devices
DELETE /api/v1/devices/:id

POST   /api/v1/usage-sessions/acquire
POST   /api/v1/usage-sessions/heartbeat
POST   /api/v1/usage-sessions/release

GET    /api/v1/licensing/public-key
POST   /api/v1/licensing/lease

POST   /api/v1/device-links/request
POST   /api/v1/device-links/approve
POST   /api/v1/device-links/claim

GET    /api/v1/history
PUT    /api/v1/history/progress
DELETE /api/v1/history/:id

GET    /api/v1/releases/latest
GET    /api/v1/releases/:id/download
POST   /api/v1/releases              # admin

GET    /api/v1/support/tickets
POST   /api/v1/support/tickets
POST   /api/v1/support/tickets/:id/messages

GET    /api/v1/admin/accounts
PATCH  /api/v1/admin/accounts/:id/status
POST   /api/v1/admin/payments/manual
POST   /api/v1/admin/activation-code-batches
```

Scalar: `http://localhost:4000/docs`

Socket.IO namespace: `/realtime`.

## Eventos realtime previstos

- `usage.session.revoked`
- `member.removed`
- `account.access.changed`

El cliente abre el socket con `auth.token` y, si desea eventos dirigidos al equipo, `auth.deviceId`.

## Storage

Desarrollo:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./storage
```

Produccion/R2:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=appnime
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://cdn.example.com
```

Los avatares se normalizan a WebP 512x512. Los releases conservan SHA-256 y pueden descargarse desde local o por URL/presigned URL del storage.

## Desarrollo

```bash
cp .env.example .env
docker compose up -d postgres
npm install
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run seed
npm run dev
```

## Pagos automaticos

El dominio ya separa `Payment`, `Subscription`, `BillingMode` y `PaymentProviderKind`, y `PaymentProvider` es un puerto para el proveedor final. La V1 incluida implementa pagos manuales y grants por codigo. El adaptador de cobro automatico se debe cerrar contra el proveedor elegido (Wompi/Mercado Pago/Stripe) porque tokenizacion, firma de webhook y renovacion dependen del proveedor; no se simula una integracion falsa dentro del core.

## Seguridad relevante

- MAC se almacena solo hasheada y como senal secundaria.
- La identidad primaria del equipo es `installationId` generado por la app.
- JWT access se valida tambien contra la sesion en DB para respetar revocaciones.
- Refresh tokens rotan; reusar un refresh anterior revoca la sesion.
- El historial es por `User`, no por `Account`.
- No se almacena actividad de reproduccion con fines de vigilancia; `WatchProgress` existe para sincronizacion del propio usuario.
