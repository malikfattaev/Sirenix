import { NextResponse } from 'next/server';

/** An error that already knows what status the client should see. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Turns any thrown value into a response.
 *
 * An `HttpError` already carries the status it means. Anything else is a fault
 * on this side and takes `fallback`, which is 502 on the routes whose work is
 * really a call to Capital.com.
 */
export function errorResponse(error: unknown, fallback = 500): NextResponse {
  if (error instanceof HttpError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : 'Unexpected error';
  return NextResponse.json({ error: message }, { status: fallback });
}
