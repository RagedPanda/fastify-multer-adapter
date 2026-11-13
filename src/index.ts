import multerModule from 'multer';
import {toMulterOptions} from './bridge.ts';
import {contentParser} from './content-parser.ts';
import {toUploadHandler} from './upload-handler.ts';
import type {DiskStorageOptions, Multer, MulterError as MulterErrorInstance, MulterErrorConstructor, Options, StorageEngine} from './types.ts';

/** multer's error class. Upload failures are instances of it, with a `code` and an HTTP `statusCode`. */
export const MulterError = multerModule.MulterError as unknown as MulterErrorConstructor;

/** An upload failure raised by multer. */
export type MulterError = MulterErrorInstance;

/** multer's disk storage engine. Its `destination` and `filename` functions receive the Fastify request. */
export const diskStorage = multerModule.diskStorage as unknown as (options?: DiskStorageOptions) => StorageEngine;

/** multer's memory storage engine: each file's contents end up in `file.buffer`. */
export const memoryStorage = multerModule.memoryStorage as unknown as () => StorageEngine;

const createMulter = (options: Options = {}): Multer => {
	const instance = multerModule(toMulterOptions(options));
	return {
		single: name => toUploadHandler(instance.single(name)),
		array: (name, maxCount) => toUploadHandler(instance.array(name, maxCount)),
		fields: fields => toUploadHandler(instance.fields(fields)),
		none: () => toUploadHandler(instance.none()),
		any: () => toUploadHandler(instance.any()),
	};
};

type MulterFactory = typeof createMulter & {
	readonly contentParser: typeof contentParser;
	readonly diskStorage: typeof diskStorage;
	readonly memoryStorage: typeof memoryStorage;
	readonly MulterError: MulterErrorConstructor;
};

/**
 * Creates an upload handler factory over the official multer. The helpers hang off it too, as
 * they did in fastify-multer: `multer.contentParser`, `multer.diskStorage`, `multer.memoryStorage`
 * and `multer.MulterError`.
 */
export const multer: MulterFactory = Object.assign(createMulter, {contentParser, diskStorage, memoryStorage, MulterError});

export default multer;
export {contentParser};
export type {
	DiskStorageOptions,
	Field,
	File,
	FileFilter,
	FileFilterCallback,
	FilesInRequest,
	FilesObject,
	GetDestination,
	GetFileName,
	Limits,
	Multer,
	MulterErrorCode,
	MulterErrorConstructor,
	Options,
	StorageEngine,
	UploadHandler,
} from './types.ts';
