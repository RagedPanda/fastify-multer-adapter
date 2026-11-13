import {mkdtempSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import Fastify, {type FastifyInstance} from 'fastify';
import {contentParser} from '../src/index.ts';

export const boundary = 'test-boundary-7MA4YWxkTrZu0gW';

export type Part =
	| {readonly name: string; readonly value: string}
	| {readonly name: string; readonly filename: string; readonly content: string | Buffer; readonly type?: string};

const partHead = (part: Part): string =>
	'filename' in part
		? `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type ?? 'text/plain'}\r\n\r\n`
		: `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`;

const partBody = (part: Part): string | Buffer => ('filename' in part ? part.content : part.value);

/** A complete multipart/form-data body. */
export const multipartBody = (parts: readonly Part[]): Buffer =>
	Buffer.concat([
		...parts.flatMap(part => [Buffer.from(`--${boundary}\r\n${partHead(part)}`), Buffer.from(partBody(part)), Buffer.from('\r\n')]),
		Buffer.from(`--${boundary}--\r\n`),
	]);

export const multipartHeaders = {'content-type': `multipart/form-data; boundary=${boundary}`};

/** A Fastify app with the content parser registered. */
export const createApp = (): FastifyInstance => {
	const app = Fastify();
	app.register(contentParser);
	return app;
};

export const postMultipart = async (app: FastifyInstance, url: string, parts: readonly Part[]) =>
	app.inject({method: 'POST', url, headers: multipartHeaders, payload: multipartBody(parts)});

export const temporaryFolder = (): string => mkdtempSync(join(tmpdir(), 'fastify-multer-adapter-'));

export const filesIn = (folder: string): string[] => readdirSync(folder);

/** A promise with its resolve function, like Promise.withResolvers on Node.js 22. */
export const deferred = <Value = void>() => {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>(settle => {
		resolve = settle;
	});
	return {promise, resolve};
};
