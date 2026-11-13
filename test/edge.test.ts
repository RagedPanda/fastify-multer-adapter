import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {connect} from 'node:net';
import {once} from 'node:events';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {createGunzip, gzipSync} from 'node:zlib';
import type {FastifyError, FastifyInstance} from 'fastify';
import multer, {diskStorage} from '../src/index.ts';
import {boundary, createApp, deferred, filesIn, multipartBody, multipartHeaders, postMultipart, temporaryFolder} from './helpers.ts';

const avatar = {name: 'avatar', filename: 'me.png', content: 'png-bytes'} as const;

/** Resolves with the next error that reaches the app's error handler. */
const nextError = (app: FastifyInstance): Promise<FastifyError> =>
	new Promise(resolve => {
		app.setErrorHandler((error, _request, reply) => {
			resolve(error as FastifyError);
			return reply.send(error);
		});
	});

/** Opens a raw connection and sends the start of a multipart request whose body never completes. */
const sendPartialUpload = async (app: FastifyInstance, path: string, fileBytes = 64 * 1024) => {
	const address = app.server.address() as {port: number};
	const socket = connect(address.port, '127.0.0.1');
	await once(socket, 'connect');
	const head = `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="big.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`;
	socket.write(`POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Type: multipart/form-data; boundary=${boundary}\r\nContent-Length: 10000000\r\n\r\n${head}`);
	socket.write(Buffer.alloc(fileBytes, 1));
	return socket;
};

test('a client that aborts mid-upload: the stored part is removed and the request settles', async () => {
	const folder = temporaryFolder();
	const app = createApp();
	const fileOpened = deferred();
	const storage = diskStorage({
		destination: folder,
		filename: (_request, _file, callback) => {
			callback(null, 'upload.bin');
			fileOpened.resolve();
		},
	});
	const error = nextError(app);
	app.post('/', {preHandler: multer({storage}).single('avatar')}, async () => 'unreachable');
	await app.listen({port: 0, host: '127.0.0.1'});
	try {
		const socket = await sendPartialUpload(app, '/');
		await fileOpened.promise;
		socket.destroy();
		const settled = await error;
		assert.equal(settled.statusCode, 400);
		assert.match(settled.message, /Request (aborted|closed)/);
		assert.deepEqual(filesIn(folder), []);
	} finally {
		await app.close();
	}
});

test('a client that closes before the upload handler runs gets a 400 instead of a hang', async () => {
	const app = createApp();
	const closed = deferred();
	const error = nextError(app);
	app.post('/', {
		// A slow hook, such as an auth check, during which the client gives up.
		preValidation: async request => {
			request.raw.once('close', () => closed.resolve());
			await closed.promise;
		},
		preHandler: multer().single('avatar'),
	}, async () => 'unreachable');
	await app.listen({port: 0, host: '127.0.0.1'});
	try {
		// With no body bytes waiting to be read, Node.js sees the close right away.
		const socket = await sendPartialUpload(app, '/', 0);
		await delay(50);
		socket.destroy();
		const settled = await error;
		assert.equal(settled.code, 'FST_MULTER_REQUEST_CLOSED');
		assert.equal(settled.statusCode, 400);
	} finally {
		await app.close();
	}
});

test('a client that closes while its body waits unread is noticed once multer reads', async () => {
	const app = createApp();
	const error = nextError(app);
	app.post('/', {
		preValidation: async () => delay(200),
		preHandler: multer().single('avatar'),
	}, async () => 'unreachable');
	await app.listen({port: 0, host: '127.0.0.1'});
	try {
		// Node.js only sees the close of a paused socket when the body is read.
		const socket = await sendPartialUpload(app, '/');
		await delay(50);
		socket.destroy();
		const settled = await error;
		assert.equal(settled.statusCode, 400);
		assert.match(settled.message, /Request (aborted|closed)/);
	} finally {
		await app.close();
	}
});

test('an onRequest hook that already read the body gets a clear 500 instead of a hang', async () => {
	const app = createApp();
	app.addHook('onRequest', async request => {
		for await (const _chunk of request.raw) {
			// Reads the whole body, as a logging or signature-checking hook might.
		}
	});
	app.post('/', {preHandler: multer().single('avatar')}, async () => 'unreachable');
	const response = await postMultipart(app, '/', [avatar]);
	assert.equal(response.statusCode, 500);
	assert.equal(response.json().code, 'FST_MULTER_BODY_ALREADY_READ');
});

test('an onRequest hook that read part of the body is caught too', async () => {
	const app = createApp();
	app.addHook('onRequest', async request => {
		await once(request.raw, 'data');
		request.raw.pause();
	});
	app.post('/', {preHandler: multer().single('avatar')}, async () => 'unreachable');
	assert.equal((await postMultipart(app, '/', [avatar])).json().code, 'FST_MULTER_BODY_ALREADY_READ');
});

test('a running upload handler on the same request twice is caught as an already-read body', async () => {
	const app = createApp();
	const upload = multer().single('avatar');
	app.post('/', {preHandler: [upload, upload]}, async () => 'unreachable');
	assert.equal((await postMultipart(app, '/', [avatar])).json().code, 'FST_MULTER_BODY_ALREADY_READ');
});

test('multer reads the stream a preParsing hook returned', async () => {
	const app = createApp();
	app.addHook('preParsing', async (request, _reply, payload) =>
		request.headers['content-encoding'] === 'gzip' ? payload.pipe(createGunzip()) : payload);
	app.post('/', {preHandler: multer({limits: {fileSize: 20}}).single('avatar')}, async request => ({
		title: (request.body as {title: string}).title,
		content: request.file.buffer?.toString(),
	}));
	const send = async (content: string) =>
		app.inject({
			method: 'POST',
			url: '/',
			headers: {...multipartHeaders, 'content-encoding': 'gzip'},
			payload: gzipSync(multipartBody([{name: 'title', value: 'zipped'}, {...avatar, content}])),
		});
	assert.deepEqual((await send('png-bytes')).json(), {title: 'zipped', content: 'png-bytes'});
	assert.equal((await send('x'.repeat(5000))).statusCode, 413);
});

test('the async context of the request reaches the route handler', async () => {
	const storage = new AsyncLocalStorage<string>();
	const app = createApp();
	app.post('/', {
		preHandler: [
			(_request, _reply, done) => storage.run('request-42', done),
			multer().single('avatar'),
		],
	}, async () => storage.getStore() ?? 'lost');
	assert.equal((await postMultipart(app, '/', [avatar])).body, 'request-42');
});
