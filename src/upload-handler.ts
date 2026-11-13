import type {FastifyRequest, HookHandlerDoneFunction} from 'fastify';
import multerModule from 'multer';
import {openContext, type ParsedRawRequest, type UploadContext} from './bridge.ts';
import {keptPayload} from './content-parser.ts';
import {hasBoundary, isMultipartType} from './content-type.ts';
import {bodyAlreadyReadError, type ErrorOrigin, missingBoundaryError, requestClosedError, statusCodeFor, withStatusCode} from './errors.ts';
import type {UploadHandler} from './types.ts';

/** Copies what multer parsed from the raw request onto the Fastify request. */
const copyUpload = (request: FastifyRequest): void => {
	const raw = request.raw as ParsedRawRequest;
	request.body = raw.body;
	if (raw.file !== undefined) {
		request.file = raw.file;
	}

	if (raw.files !== undefined) {
		request.files = raw.files;
	}
};

/** Whether the client went away before sending the whole body. */
const clientClosed = (request: FastifyRequest): boolean => request.raw.destroyed && !request.raw.complete;

const originOf = (error: Error, context: UploadContext): ErrorOrigin => {
	if (error instanceof multerModule.MulterError) {
		return 'multer';
	}

	return context.clientErrors.has(error) || clientClosed(context.request) ? 'client' : 'server';
};

/** Stops reading a body stream that a preParsing hook returned, which multer doesn't know about. */
const releasePayload = (context: UploadContext): void => {
	if (context.payload !== context.request.raw && context.busboy !== undefined) {
		context.payload.unpipe(context.busboy);
		context.payload.resume();
	}
};

const finish = (context: UploadContext, error: unknown, done: HookHandlerDoneFunction): void => {
	if (context.busboy !== undefined) {
		copyUpload(context.request);
	}

	releasePayload(context);
	if (error === undefined || error === null) {
		done();
	} else if (error instanceof Error) {
		done(withStatusCode(error, statusCodeFor(error, originOf(error, context))));
	} else {
		// A storage engine that calls back with something other than an Error; Fastify reports it as a 500.
		done(error as Error);
	}
};

/** Why the body can't be handed to multer, or undefined when it can. */
const unreadableBodyError = (request: FastifyRequest, contentType: string): Error | undefined => {
	const payload = keptPayload(request) ?? request.raw;
	if (!hasBoundary(contentType)) {
		return missingBoundaryError();
	}

	// multer would wait forever for a body that was already consumed or will never arrive.
	if (payload.readableDidRead || payload.readableEnded) {
		return bodyAlreadyReadError();
	}

	return payload.destroyed || request.raw.destroyed ? requestClosedError() : undefined;
};

/** Turns one of multer's Express-style middlewares into a Fastify hook. */
export const toUploadHandler = (middleware: multerModule.Middleware): UploadHandler => (request, reply, done) => {
	const contentType = request.headers['content-type'];
	if (!isMultipartType(contentType)) {
		done();
		return;
	}

	const error = unreadableBodyError(request, contentType);
	if (error !== undefined) {
		done(error);
		return;
	}

	const context = openContext(request, keptPayload(request) ?? request.raw);
	middleware(request.raw, reply.raw, multerError => finish(context, multerError, done));
};
