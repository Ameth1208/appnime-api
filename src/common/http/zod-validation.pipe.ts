import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}
  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) throw new BadRequestException({ code: 'VALIDATION_ERROR', issues: parsed.error.issues });
    return parsed.data;
  }
}
