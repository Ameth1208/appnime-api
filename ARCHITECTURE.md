# Arquitectura del backend de AppNime

## Modulos

```text
src/
├── common/
│   ├── config
│   ├── crypto
│   ├── database
│   ├── dates
│   ├── http
│   ├── security
│   └── storage
└── modules/
    ├── accounts
    ├── activation-codes
    ├── admin
    ├── auth
    ├── device-links
    ├── devices
    ├── health
    ├── history
    ├── licensing
    ├── members
    ├── payments
    ├── plans
    ├── realtime
    ├── releases
    ├── subscriptions
    ├── support
    ├── usage-sessions
    └── users
```

Los casos con reglas de negocio se separan en `application/use-cases`. Controllers adaptan HTTP y no deben acumular reglas comerciales.

## Agregados principales

### Account

Es la unidad comercial. Contiene owner, miembros, suscripcion, pagos y dispositivos. La suscripcion nunca pertenece a un email individual.

### AccountMember

Un usuario solo debe tener una membresia `ACTIVE` a la vez. Family admite 4 miembros extra ademas del owner. Cada persona recibe su propio cupo de tres dispositivos.

### Device

Equipo autorizado. `installationId` es la identidad principal. MAC/fingerprint son senales secundarias hasheadas. Revocar un Device revoca auth sessions y usage sessions ligadas al equipo.

### Session

Sesion de autenticacion, con refresh token rotatorio. Puede sobrevivir a que el usuario deje de reproducir contenido.

### UsageSession

Controla simultaneidad. El plan V1 permite una por persona. `acquire` revoca las anteriores del mismo usuario y emite `usage.session.revoked` al equipo previo.

### Subscription

Periodo comercial. Puede venir de pago manual, automatico, codigo o permiso permanente. El periodo usa meses/anios calendario, no bloques artificiales de 30/365 dias.

### ActivationCode

Grant comercial fuera de pasarela. El codigo en claro no se persiste; se almacena SHA-256. Los lotes permiten campaign/reseller para trazabilidad de ventas externas.

### DeviceLink

Handshake temporal TV-movil. Tiene un codigo humano y un `claimSecret` distinto. Aprobar el codigo registra la TV dentro del cupo del usuario; claim entrega tokens una unica vez.

### AccessLease

JWT Ed25519 verificable offline. Contiene cuenta, usuario, dispositivo, plan, fecha de corte/gracia y `refreshAfter`. La llave privada se persiste en `storage/keys` para que un reinicio no invalide leases existentes.

## Tolerancia a fallos

```text
API responde 200        -> renovar estado/lease
API responde 401/403    -> rechazo explicito; bloquear segun codigo
Timeout/DNS/502/503     -> no logout; usar lease local valido
Fin comercial           -> 48h payment grace
Servidor no disponible  -> hasta 72h offline grace adicionales
```

## Sincronizacion de historial

`WatchProgress` es por usuario. La app Flutter debe escribir primero su estado local y sincronizar backend en segundo plano oportunista. Una falla del backend nunca debe interrumpir playback ni borrar progreso local.

## Actualizaciones

Cada `AppRelease` se segmenta por plataforma, arquitectura y canal. `ReleasePolicy` puede ser `OPTIONAL`, `RECOMMENDED` o `REQUIRED`. El binario vive en ObjectStorage; la DB solo guarda metadata, object key, tamano y SHA-256.

## Pago automatico

El core no depende de Wompi, Mercado Pago o Stripe. `PaymentProvider` es el puerto. El adaptador de produccion debe convertir webhooks verificados a operaciones idempotentes sobre `Payment` y `Subscription`. Nunca se activa una suscripcion porque Flutter afirme que pago.
