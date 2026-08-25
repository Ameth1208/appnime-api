import { SetMetadata } from '@nestjs/common';
import { SKIP_API_KEY } from '../guards/api-key.guard';

/// Exenta un controller/handler de la exigencia de API key global.
/// Usar SOLO en rutas con autenticación propia (auth, admin con JWT) o
/// públicas por diseño (health).
export const SkipApiKey = () => SetMetadata(SKIP_API_KEY, true);
