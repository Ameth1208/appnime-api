import { Injectable } from '@nestjs/common'; import { createHash } from 'node:crypto';
@Injectable() export class DeviceFingerprintService { hash(value?: string) { return value ? createHash('sha256').update(value).digest('hex') : null; } }
