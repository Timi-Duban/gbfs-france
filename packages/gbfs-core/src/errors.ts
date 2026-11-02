import type { GbfsErrorKind } from './types';

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
