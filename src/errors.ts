/** Codes of the MulterErrors that mean a size or count limit was exceeded. */
const limitCodes: ReadonlySet<string> = new Set([
	'LIMIT_PART_COUNT',
	'LIMIT_FILE_SIZE',
	'LIMIT_FILE_COUNT',
	'LIMIT_FIELD_KEY',
	'LIMIT_FIELD_VALUE',
	'LIMIT_FIELD_COUNT',
]);

/**
 * The HTTP status for a MulterError: 413 Content Too Large for an exceeded limit, the same status
 * @fastify/multipart uses, and 400 Bad Request for every other code, since each one is caused by
 * what the client sent.
 */
export const statusCodeForMulterCode = (code: string): number => (limitCodes.has(code) ? 413 : 400);

export type ErrorOrigin = 'multer' | 'client' | 'server';

/** The status for an error by where it came from, or undefined to let Fastify use its own (500, or the error's `statusCode`). */
export const statusCodeFor = (error: Error & {code?: unknown}, origin: ErrorOrigin): number | undefined => {
	if (origin === 'multer') {
		return statusCodeForMulterCode(String(error.code));
	}

	return origin === 'client' ? 400 : undefined;
};

/**
 * Gives an error the status Fastify replies with, unless it already has one. The error object
 * itself is kept, so `instanceof MulterError` and `error.code` still work in an error handler.
 */
export const withStatusCode = <ErrorType extends Error>(error: ErrorType, statusCode: number | undefined): ErrorType => {
	const current = (error as {statusCode?: unknown}).statusCode;
	return statusCode === undefined || typeof current === 'number' ? error : Object.assign(error, {statusCode});
};

/** An error raised by the adapter itself, in the shape Fastify's default error handler replies with. */
export const adapterError = (code: string, message: string, statusCode: number): Error & {code: string; statusCode: number} =>
	Object.assign(new Error(message), {code, statusCode});

export const missingBoundaryError = (): Error =>
	adapterError('FST_MULTER_MISSING_BOUNDARY', 'The multipart Content-Type header has no boundary', 400);

export const bodyAlreadyReadError = (): Error =>
	adapterError(
		'FST_MULTER_BODY_ALREADY_READ',
		'The request body was read before the upload handler ran, for example by an onRequest or preParsing hook, so multer cannot parse it',
		500,
	);

export const requestClosedError = (): Error =>
	adapterError('FST_MULTER_REQUEST_CLOSED', 'The client closed the request before the upload was parsed', 400);
