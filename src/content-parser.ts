import type {FastifyPluginCallback, FastifyRequest} from 'fastify';
import type {Readable} from 'node:stream';
import {packageName} from './name.ts';

// A registered symbol, so the ESM and CommonJS builds of this package find the same property
// when an app ends up loading both.
const payloadKey = Symbol.for(`${packageName}.payload`);

type WithPayload = {[payloadKey]: Readable | null};

/** The body stream the multipart parser kept for this request, or undefined when it didn't run. */
export const keptPayload = (request: FastifyRequest): Readable | undefined =>
	(request as unknown as WithPayload)[payloadKey] ?? undefined;

/**
 * Fastify's content type parser for multipart/form-data. It doesn't read the body: it keeps the
 * stream for the upload handler, which hands it to multer. The stream is the one after any
 * preParsing hooks, so a hook that decompresses or counts the body still applies.
 */
function keepPayload(request: FastifyRequest, payload: Readable, done: (error: Error | null) => void): void {
	(request as unknown as WithPayload)[payloadKey] = payload;
	done(null);
}

function isMultipart(this: FastifyRequest): boolean {
	return keptPayload(this) !== undefined;
}

function registerMultipart(fastify: Parameters<FastifyPluginCallback>[0], _options: unknown, done: (error?: Error) => void): void {
	// A string, not 'multipart': Fastify 5 only accepts full media types or a RegExp.
	fastify.addContentTypeParser('multipart/form-data', keepPayload);
	fastify.decorateRequest(payloadKey, null);
	// @fastify/multipart defines the same method; keep whichever came first.
	if (!fastify.hasRequestDecorator('isMultipart')) {
		fastify.decorateRequest('isMultipart', isMultipart);
	}

	done();
}

/**
 * The Fastify plugin that lets multipart/form-data requests through to the upload handlers.
 * Register it once, in the scope (or a parent of the scope) where your upload routes live.
 *
 * It sets the symbols fastify-plugin would set, so its parser applies to the scope it is
 * registered in rather than to a scope of its own, without a dependency on fastify-plugin.
 */
export const contentParser: FastifyPluginCallback = Object.assign(registerMultipart, {
	[Symbol.for('skip-override')]: true,
	[Symbol.for('fastify.display-name')]: packageName,
	[Symbol.for('plugin-meta')]: {name: packageName, fastify: '5.x'},
});
