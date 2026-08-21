import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  const corsOrigins = config.get<string>('CORS_ORIGINS', '*');
  app.enableCors({
    origin: true,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: true,
  });
  app.setGlobalPrefix('api', { exclude: ['health'] });
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('AppNime API')
      .setDescription('Accounts, subscriptions, activation codes, devices, licensing, sync, support and releases.')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  app.use(
    '/docs',
    apiReference({
      spec: {
        content: document,
      },
      theme: 'purple',
    }),
  );
  await app.listen(Number(config.get('PORT', 4000)));
}

void bootstrap();
