import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalStorageController } from './local-storage.controller';
import { LocalStorageService } from './local-storage.service';
import { S3StorageService } from './s3-storage.service';
import { ObjectStorage } from './storage.types';

@Global()
@Module({
  controllers: [LocalStorageController],
  providers: [
    LocalStorageService,
    S3StorageService,
    {
      provide: ObjectStorage,
      inject: [ConfigService, LocalStorageService, S3StorageService],
      useFactory: (config: ConfigService, local: LocalStorageService, s3: S3StorageService) =>
        config.get('STORAGE_DRIVER', 'local') === 's3' ? s3 : local,
    },
  ],
  exports: [ObjectStorage],
})
export class StorageModule {}
