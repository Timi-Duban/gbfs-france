import type { GbfsErrorKind } from './types';

export const GBFS_ERROR_KINDS = [
  'unreachable',
  'timeout',
  'invalid-feed',
  'unsupported-version',
  'unknown-network',
  'not-supported-network',
  'station-not-found',
] as const;

/** Internal error thrown inside the core; the facade turns it into a `Result` error. */
export class FeedFailure extends Error {
  constructor(
    readonly kind: GbfsErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'FeedFailure';
  }
}
