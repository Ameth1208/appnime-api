import path from 'node:path';
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.resolve(__dirname, 'prisma/schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://appnime:appnime@localhost:5432/appnime?schema=public',
  },
});