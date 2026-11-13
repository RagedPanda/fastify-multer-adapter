import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import Fastify, {type FastifyRequest} from 'fastify';
import multer, {contentParser, diskStorage, memoryStorage, MulterError, type File, type StorageEngine} from '../src/index.ts';
import {createApp, filesIn, multipartBody, multipartHeaders, postMultipart, temporaryFolder} from './helpers.ts';

const avatar = {name: 'avatar', filename: 'me.png', content: 'png-bytes', type: 'image/png'} as const;

test('single() puts the file on request.file and the fields on request.body', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().single('avatar')}, async request => ({
		body: request.body,
		file: {...request.file, buffer: request.file.buffer?.toString()},
		isMultipart: request.isMultipart(),
	}));
	const response = await postMultipart(app, '/', [{name: 'title', value: 'hello'}, {name: 'tags[]', value: 'a'}, {name: 'tags[]', value: 'b'}, avatar]);
	assert.equal(response.statusCode, 200);
	assert.deepEqual(response.json(), {
		body: {title: 'hello', tags: ['a', 'b']},
		file: {fieldname: 'avatar', originalname: 'me.png', encoding: '7bit', mimetype: 'image/png', buffer: 'png-bytes', size: 9},
		isMultipart: true,
	});
});

test('single() without a file leaves request.file unset', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().single('avatar')}, async request => ({hasFile: request.file !== undefined, body: request.body}));
	const response = await postMultipart(app, '/', [{name: 'title', value: 'hello'}]);
	assert.deepEqual(response.json(), {hasFile: false, body: {title: 'hello'}});
});

test('array() puts the files on request.files and enforces maxCount', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().array('photos', 2)}, async request => (request.files as File[]).map(file => file.originalname));
	const photo = (filename: string) => ({name: 'photos', filename, content: filename});
	assert.deepEqual((await postMultipart(app, '/', [photo('a'), photo('b')])).json(), ['a', 'b']);

	const tooMany = await postMultipart(app, '/', [photo('a'), photo('b'), photo('c')]);
	assert.equal(tooMany.statusCode, 400);
	assert.equal(tooMany.json().code, 'LIMIT_UNEXPECTED_FILE');
});

test('fields() groups the files by field name', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().fields([{name: 'avatar', maxCount: 1}, {name: 'gallery'}])}, async request => {
		const files = request.files as Record<string, File[]>;
		return Object.fromEntries(Object.entries(files).map(([name, list]) => [name, list.map(file => file.originalname)]));
	});
	const response = await postMultipart(app, '/', [avatar, {name: 'gallery', filename: 'g1', content: '1'}, {name: 'gallery', filename: 'g2', content: '2'}]);
	assert.deepEqual(response.json(), {avatar: ['me.png'], gallery: ['g1', 'g2']});
});

test('none() accepts text fields and rejects files', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().none()}, async request => request.body);
	assert.deepEqual((await postMultipart(app, '/', [{name: 'a', value: '1'}])).json(), {a: '1'});
	const withFile = await postMultipart(app, '/', [avatar]);
	assert.equal(withFile.statusCode, 400);
	assert.deepEqual(withFile.json(), {statusCode: 400, code: 'LIMIT_UNEXPECTED_FILE', error: 'Bad Request', message: 'Unexpected file field'});
});

test('any() accepts every file', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().any()}, async request => (request.files as File[]).map(file => file.fieldname));
	assert.deepEqual((await postMultipart(app, '/', [avatar, {name: 'other', filename: 'x', content: 'x'}])).json(), ['avatar', 'other']);
});

test('dest and diskStorage write files to disk, and diskStorage callbacks get the Fastify request', async () => {
	const destFolder = temporaryFolder();
	const storageFolder = temporaryFolder();
	const seen: string[] = [];
	const storage = diskStorage({
		destination: (request, _file, callback) => {
			seen.push(request.routeOptions.url!);
			callback(null, storageFolder);
		},
		filename: (request, file, callback) => callback(null, `${(request.params as {id: string}).id}-${file.originalname}`),
	});
	const app = createApp();
	app.post('/dest', {preHandler: multer({dest: destFolder}).single('avatar')}, async request => request.file.path);
	app.post('/storage/:id', {preHandler: multer({storage}).single('avatar')}, async request => request.file.path);

	const destPath = (await postMultipart(app, '/dest', [avatar])).body;
	assert.equal(readFileSync(destPath, 'utf8'), 'png-bytes');
	const storagePath = (await postMultipart(app, '/storage/42', [avatar])).body;
	assert.equal(storagePath, join(storageFolder, '42-me.png'));
	assert.deepEqual(seen, ['/storage/:id']);
});

test('memoryStorage keeps the file in a buffer', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer({storage: memoryStorage()}).single('avatar')}, async request => request.file.buffer?.toString());
	assert.equal((await postMultipart(app, '/', [avatar])).body, 'png-bytes');
});

test('fileFilter gets the Fastify request with the fields sent before the file', async () => {
	const app = createApp();
	const upload = multer({
		fileFilter: (request, file, callback) => {
			const body = request.body as {allow?: string};
			callback(null, body.allow === 'yes' && file.mimetype === 'image/png' && request.headers['x-user'] === 'ann');
		},
	});
	app.post('/', {preHandler: upload.single('avatar')}, async request => ({kept: request.file !== undefined}));
	const send = async (allow: string) =>
		app.inject({method: 'POST', url: '/', headers: {...multipartHeaders, 'x-user': 'ann'}, payload: multipartBody([{name: 'allow', value: allow}, avatar])});
	assert.deepEqual((await send('yes')).json(), {kept: true});
	assert.deepEqual((await send('no')).json(), {kept: false});
});

test('a fileFilter error fails the request through the error handler', async () => {
	const app = createApp();
	const upload = multer({fileFilter: (_request, _file, callback) => callback(Object.assign(new Error('Only images'), {statusCode: 422}))});
	app.post('/', {preHandler: upload.single('avatar')}, async () => 'unreachable');
	const response = await postMultipart(app, '/', [avatar]);
	assert.equal(response.statusCode, 422);
	assert.equal(response.json().message, 'Only images');
});

test('limits reply 413 with the multer code, and a limits function gets the Fastify request', async () => {
	const app = createApp();
	const limitsFor = (request: FastifyRequest) => ({fileSize: request.headers['x-plan'] === 'pro' ? 100 : 3});
	app.post('/static', {preHandler: multer({limits: {fileSize: 3}}).single('avatar')}, async () => 'ok');
	app.post('/dynamic', {preHandler: multer({limits: limitsFor}).single('avatar')}, async () => 'ok');

	const tooLarge = await postMultipart(app, '/static', [avatar]);
	assert.equal(tooLarge.statusCode, 413);
	assert.deepEqual(tooLarge.json(), {statusCode: 413, code: 'LIMIT_FILE_SIZE', error: 'Payload Too Large', message: 'File too large'});

	const send = async (plan: string) => app.inject({method: 'POST', url: '/dynamic', headers: {...multipartHeaders, 'x-plan': plan}, payload: multipartBody([avatar])});
	assert.equal((await send('free')).statusCode, 413);
	assert.equal((await send('pro')).statusCode, 200);
});

test('an error handler sees the MulterError itself', async () => {
	const app = createApp();
	app.setErrorHandler((error, _request, reply) => {
		const isMulterError = error instanceof MulterError;
		const {statusCode, code, field} = error as MulterError;
		return reply.status(statusCode ?? 500).send({isMulterError, code, field});
	});
	app.post('/', {preHandler: multer({limits: {fields: 1}}).none()}, async () => 'ok');
	const response = await postMultipart(app, '/', [{name: 'a', value: '1'}, {name: 'b', value: '2'}]);
	assert.equal(response.statusCode, 413);
	assert.deepEqual(response.json(), {isMulterError: true, code: 'LIMIT_FIELD_COUNT'});
});

test('invalid limits throw when the upload handler is created', () => {
	assert.throws(() => multer({limits: {fileSize: 1.5}}), /Expected limits.fileSize/);
});

test('a limits function that throws is a 500', async () => {
	const app = createApp();
	const upload = multer({
		limits: () => {
			throw new Error('no plan');
		},
	});
	app.post('/', {preHandler: upload.single('avatar')}, async () => 'ok');
	assert.equal((await postMultipart(app, '/', [avatar])).statusCode, 500);
});

test('storage engine errors are 500s, and errors that are not Error objects pass through', async () => {
	const failingStorage = (error: unknown): StorageEngine => ({
		_handleFile: (_request, file, callback) => {
			file.stream!.resume();
			callback(error as Error);
		},
		_removeFile: (_request, _file, callback) => callback(null),
	});
	const app = createApp();
	app.post('/error', {preHandler: multer({storage: failingStorage(new Error('disk full'))}).single('avatar')}, async () => 'ok');
	app.post('/string', {preHandler: multer({storage: failingStorage('disk full')}).single('avatar')}, async () => 'ok');
	const response = await postMultipart(app, '/error', [avatar]);
	assert.equal(response.statusCode, 500);
	assert.equal(response.json().message, 'disk full');
	assert.equal((await postMultipart(app, '/string', [avatar])).statusCode, 500);
});

test('files already stored are removed when a later part fails', async () => {
	const folder = temporaryFolder();
	const app = createApp();
	app.post('/', {preHandler: multer({dest: folder, limits: {fileSize: 5}}).array('photos')}, async () => 'ok');
	const response = await postMultipart(app, '/', [
		{name: 'photos', filename: 'small', content: 'tiny'},
		{name: 'photos', filename: 'large', content: 'much too large'},
	]);
	assert.equal(response.statusCode, 413);
	assert.deepEqual(filesIn(folder), []);
});

test('a malformed body is a 400', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().single('avatar')}, async () => 'ok');
	const truncated = multipartBody([avatar]).subarray(0, 120);
	const response = await app.inject({method: 'POST', url: '/', headers: multipartHeaders, payload: truncated});
	assert.equal(response.statusCode, 400);
	assert.equal(response.json().message, 'Unexpected end of form');

	const truncatedField = multipartBody([{name: 'title', value: 'hello'}]).subarray(0, 60);
	assert.equal((await app.inject({method: 'POST', url: '/', headers: multipartHeaders, payload: truncatedField})).statusCode, 400);
});

test('a multipart Content-Type without a boundary is a 400', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().single('avatar')}, async () => 'ok');
	const response = await app.inject({method: 'POST', url: '/', headers: {'content-type': 'multipart/form-data'}, payload: 'x'});
	assert.equal(response.statusCode, 400);
	assert.equal(response.json().code, 'FST_MULTER_MISSING_BOUNDARY');
});

test('requests that are not multipart pass through untouched', async () => {
	const app = createApp();
	app.post('/', {preHandler: multer().single('avatar')}, async request => ({body: request.body, isMultipart: request.isMultipart()}));
	app.get('/', {preHandler: multer().single('avatar')}, async request => ({isMultipart: request.isMultipart()}));
	assert.deepEqual((await app.inject({method: 'POST', url: '/', payload: {a: 1}})).json(), {body: {a: 1}, isMultipart: false});
	assert.deepEqual((await app.inject({method: 'GET', url: '/', headers: multipartHeaders})).json(), {isMultipart: false});
});

test('as a preValidation hook, the parsed body goes through schema validation', async () => {
	const app = createApp();
	app.post('/', {
		preValidation: multer().single('avatar'),
		schema: {body: {type: 'object', required: ['title'], properties: {title: {type: 'string', minLength: 3}}}},
	}, async request => request.body);
	assert.equal((await postMultipart(app, '/', [{name: 'title', value: 'hello'}, avatar])).statusCode, 200);
	const invalid = await postMultipart(app, '/', [{name: 'title', value: 'hi'}, avatar]);
	assert.equal(invalid.statusCode, 400);
	assert.equal(invalid.json().code, 'FST_ERR_VALIDATION');
});

test('routes keep their own configuration', async () => {
	const app = createApp();
	app.post('/small', {preHandler: multer({limits: {fileSize: 3}}).single('avatar')}, async () => 'small');
	app.post('/large', {preHandler: multer({limits: {fileSize: 100}}).single('avatar')}, async () => 'large');
	app.post('/docs', {preHandler: multer().single('document')}, async () => 'docs');
	assert.equal((await postMultipart(app, '/small', [avatar])).statusCode, 413);
	assert.equal((await postMultipart(app, '/large', [avatar])).statusCode, 200);
	assert.equal((await postMultipart(app, '/docs', [avatar])).json().code, 'LIMIT_UNEXPECTED_FILE');
});

test('the parser applies to the scope it is registered in, and not to sibling scopes', async () => {
	const app = Fastify();
	await app.register(async uploads => {
		await uploads.register(contentParser);
		uploads.post('/uploads', {preHandler: multer().single('avatar')}, async request => request.file.originalname);
	});
	await app.register(async other => {
		other.post('/other', async () => 'ok');
	});
	assert.equal((await postMultipart(app, '/uploads', [avatar])).body, 'me.png');
	assert.equal((await postMultipart(app, '/other', [avatar])).statusCode, 415);
});

test('registered at the root, the parser reaches every scope', async () => {
	const app = createApp();
	await app.register(async child => {
		child.post('/child', {preHandler: multer().single('avatar')}, async request => request.file.originalname);
	}, {prefix: '/api'});
	assert.equal((await postMultipart(app, '/api/child', [avatar])).body, 'me.png');
});

test('the default export carries the helpers fastify-multer had', () => {
	assert.equal(multer.contentParser, contentParser);
	assert.equal(multer.diskStorage, diskStorage);
	assert.equal(multer.memoryStorage, memoryStorage);
	assert.equal(multer.MulterError, MulterError);
	assert.equal(new MulterError('LIMIT_FILE_SIZE', 'avatar').field, 'avatar');
});

test('the plugin keeps an isMultipart decorator that is already there', async () => {
	const app = Fastify();
	app.decorateRequest('isMultipart', () => true);
	await app.register(contentParser);
	app.post('/', async request => request.isMultipart());
	assert.equal((await app.inject({method: 'POST', url: '/', payload: {}})).body, 'true');
});
