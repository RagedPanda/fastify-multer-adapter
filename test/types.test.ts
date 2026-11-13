import assert from 'node:assert/strict';
import {test} from 'node:test';
import Fastify, {type FastifyRequest} from 'fastify';
import multer, {type File, type FileFilter, type MulterError, type StorageEngine} from '../src/index.ts';
import {temporaryFolder} from './helpers.ts';

// These checks run when `npm run typecheck` compiles this file; the test only makes sure it builds an app.
const buildApp = () => {
	const app = Fastify();

	// fastify-multer's README example, with only the import changed (and a temporary folder, as multer creates it).
	const upload = multer({dest: temporaryFolder()});
	app.register(multer.contentParser);
	app.route({
		method: 'POST',
		url: '/profile',
		preHandler: upload.single('avatar'),
		handler: async request => {
			const path: string | undefined = request.file.path;
			const name: string = request.file.originalname;
			return {path, name, body: request.body};
		},
	});

	// Typed routes and hook arrays accept the upload handler.
	app.post<{Body: {title: string}; Params: {id: string}}>('/posts/:id', {
		preValidation: [upload.array('photos', 4)],
		preHandler: [async () => undefined, upload.none()],
	}, async request => {
		const title: string = request.body.title;
		const files = request.files as File[];
		return {title, count: files.length, multipart: request.isMultipart()};
	});

	// A storage engine written against the Fastify request, as with fastify-multer.
	const storage: StorageEngine = {
		_handleFile: (request, file, callback) => callback(null, {path: `${request.id}/${file.originalname}`}),
		_removeFile: (_request, _file, callback) => callback(null),
	};
	const fileFilter: FileFilter = (request: FastifyRequest, file, callback) => callback(null, request.headers['x-ok'] === '1' && file.size === undefined);
	multer({storage, fileFilter, limits: request => (request.headers['x-pro'] === '1' ? {fileSize: 1e9} : {fileSize: 1e6})});
	multer.diskStorage({destination: (_request, _file, callback) => callback(null, '/tmp'), filename: (_request, file, callback) => callback(null, file.originalname)});

	app.setErrorHandler((error, _request, reply) => {
		if (error instanceof multer.MulterError) {
			const multerError: MulterError = error;
			return reply.status(multerError.statusCode ?? 400).send({code: multerError.code});
		}

		return reply.send(error);
	});

	// Never called: these only need to fail to compile.
	const misuse = () => {
		// @ts-expect-error: limits must be numbers.
		multer({limits: {fileSize: '1mb'}});
		// @ts-expect-error: fields() takes a list of fields.
		upload.fields('avatar');
	};

	return {app, misuse};
};

test('the typed examples build an app', async () => {
	const {app, misuse} = buildApp();
	assert.equal(typeof misuse, 'function');
	await app.ready();
	assert.ok(app.hasRoute({method: 'POST', url: '/profile'}));
	await app.close();
});
