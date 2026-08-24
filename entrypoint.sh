#!/bin/sh
# Aplica cambios de schema de Prisma antes de arrancar el server.
echo "Applying database schema..."
npx prisma db push --skip-generate
echo "Starting AppNime API..."
exec node dist/main.js
