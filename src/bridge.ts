import type {FastifyRequest} from 'fastify';
import type {IncomingMessage} from 'node:http';
import type {Readable, Writable} from 'node:stream';
import type multer from 'multer';
import {withDefaultLimits} from './limits.ts';
import type {File, FileFilter, Limits, Options, StorageEngine} from './types.ts';

/** What the adapter knows about one request while multer parses it. */
export type UploadContext = {
	readonly request: FastifyRequest;
	/** The body stream: `request.raw`, or the stream a preParsing hook returned. */
	readonly payload: Readable;
	/** Errors raised by busboy while it parsed the body, which the client caused. */
	readonly clientErrors: WeakSet<object>;
	/** The parser multer created, once it starts reading the body. */
	busboy: Writable | undefined;
};

/** The raw request multer sees, with the properties it writes. */
export type ParsedRawRequest = IncomingMessage & {body?: unknown; file?: File; files?: File[] | Record<string, File[]>};

// multer calls the storage engine, fileFilter and limits with the request it was given, which has
// to be the raw Node.js request because multer reads it as a stream. This map lets those calls
// receive the Fastify request instead, as they did with fastify-multer.
const contexts = new WeakMap<IncomingMessage, UploadContext>();

export const openContext = (request: FastifyRequest, payload: Readable): UploadContext => {
	const context: UploadContext = {request, payload, clientErrors: new WeakSet(), busboy: undefined};
	contexts.set(request.raw, context);
	return context;
};

// multer only calls back with a request the upload handler opened a context for.
const contextFor = (raw: IncomingMessage): UploadContext => contexts.get(raw)!;

const requestFor = (raw: IncomingMessage): FastifyRequest => contextFor(raw).request;

const bridgeStorage = (storage: StorageEngine): multer.RawStorageEngine => ({
	_handleFile: (raw, file, callback) => storage._handleFile(requestFor(raw), file as File, callback),
	_removeFile: (raw, file, callback) => storage._removeFile(requestFor(raw), file as File, callback),
});

const bridgeFileFilter = (fileFilter: FileFilter): multer.RawFileFilter =>
	(raw, file, callback) => fileFilter(requestFor(raw), file as File, callback);

const bridgeLimits = (limits: (request: FastifyRequest) => Limits | undefined) =>
	(raw: IncomingMessage): Limits => withDefaultLimits(limits(requestFor(raw)));

/**
 * Feeds the body to busboy, in place of multer's default `req.pipe(busboy)`. It reads the stream
 * Fastify handed the content type parser, and marks busboy's errors as caused by the client, so
 * a malformed body gets a 400 instead of a 500.
 */
const startParsing = (raw: IncomingMessage, busboy: Writable): void => {
	const context = contextFor(raw);
	const markClientError = (error: object): void => void context.clientErrors.add(error);
	context.busboy = busboy;
	// The same object multer fills in, so a fileFilter sees the fields that came before its file.
	context.request.body = (raw as ParsedRawRequest).body;
	busboy.prependListener('error', markClientError);
	busboy.prependListener('file', (_fieldname: string, fileStream: Readable) => fileStream.prependListener('error', markClientError));
	context.payload.pipe(busboy);
};

/** multer options that call the user's storage engine, fileFilter and limits with the Fastify request. */
export const toMulterOptions = (options: Options): multer.RawOptions => ({
	...options,
	...(options.storage === undefined ? {} : {storage: bridgeStorage(options.storage)}),
	...(options.fileFilter === undefined ? {} : {fileFilter: bridgeFileFilter(options.fileFilter)}),
	limits: typeof options.limits === 'function' ? bridgeLimits(options.limits) : withDefaultLimits(options.limits),
	streamHandler: startParsing,
});
