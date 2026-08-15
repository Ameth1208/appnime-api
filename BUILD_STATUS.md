# Build status

## Verificado en este entorno

- 98 archivos TypeScript parseados con la API del compilador TypeScript: 0 errores de sintaxis.
- No hay marcadores TODO/FIXME en `src`, `prisma` o `test`.
- Los modulos de negocio estan divididos; ningun archivo TypeScript supera aproximadamente 100 lineas salvo que se expanda en el futuro.
- README y ARCHITECTURE reflejan las reglas comerciales acordadas.

## No verificable en este entorno

`npm install` alcanzo dos veces el timeout de ejecucion antes de crear `node_modules`. Por lo tanto NO se afirma que se hayan ejecutado exitosamente aqui:

```bash
npm run db:validate
npm run db:generate
npm run build
npm test
```

Son los primeros comandos que deben correrse en una maquina con acceso normal al registry de npm. Si Prisma detecta una incompatibilidad de schema o TypeScript una incompatibilidad de version de dependencia, debe corregirse antes de desplegar.

## Pago automatico

El core y el puerto `PaymentProvider` estan listos. Pago manual, codigos y grants permanentes estan implementados. El adaptador de cobro automatico real no esta falsificado: requiere elegir y configurar Wompi, Mercado Pago o Stripe con sus credenciales y firmas de webhook.
