import { Injectable } from '@nestjs/common';
import type { PlaybackLease } from '../../../domain/types';
import type { SourceCandidate } from '../../../application/source-registry.service';
import type { ServerResolver } from './server-resolver';
import { UnlimplaySourceResolver } from './unlimplay.resolver';
import { VidlinkSourceResolver } from './vidlink.resolver';
import { NsrPlaySourceResolver } from './nsrplay.resolver';

/**
 * Registro de resolvers por servidor. Un mismo servidor (p.ej. streamwish)
 * se resuelve con un solo resolver sin importar el provider que lo exponga.
 */
@Injectable()
export class ResolverRegistry {
  private readonly resolvers: ServerResolver[];

  constructor(
    unlimplay: UnlimplaySourceResolver,
    vidlink: VidlinkSourceResolver,
    nsrplay: NsrPlaySourceResolver,
  ) {
    this.resolvers = [unlimplay, vidlink, nsrplay];
  }

  resolverFor(providerId: string, serverId: string): ServerResolver | null {
    return this.resolvers.find((r) => r.supports(providerId, serverId)) ?? null;
  }

  async resolve(source: SourceCandidate): Promise<PlaybackLease[]> {
    const resolver = this.resolverFor(source.providerId, source.serverId);
    if (!resolver) throw new Error(`sin resolver para ${source.providerId}/${source.serverId}`);
    return resolver.resolve(source);
  }
}
