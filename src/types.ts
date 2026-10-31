import type {FastifyReply, FastifyRequest, HookHandlerDoneFunction} from 'fastify';
import type {Readable} from 'node:stream';

/**
 * A file parsed from a multipart request. It is an interface, so a storage engine that adds
 * properties (such as multer-s3's `location`) can be described with declaration merging.
 */
export interface File {
	/** Name of the form field. */
	fieldname: string;
	/** Name of the file on the client. Client-supplied, so treat it as untrusted. */
	originalname: string;
	/** Transfer encoding of the file. */
	encoding: string;
	/** MIME type sent by the client. Client-supplied, so treat it as untrusted. */
	mimetype: string;
	/** Size of the file in bytes, set once the file is stored. */
	size?: number;
	/** Folder the file was saved to (`diskStorage`). */
	destination?: string;
	/** Name of the file within `destination` (`diskStorage`). */
	filename?: string;
	/** Full path of the saved file (`diskStorage`). */
	path?: string;
	/** Contents of the file (`memoryStorage`). */
	buffer?: Buffer;
	/** The file data. Only present while a storage engine's `_handleFile` runs. */
	stream?: Readable;
}

/** Files from `fields()`, keyed by field name. */
export type FilesObject = Record<string, File[]>;

/** `request.files`: an array from `array()` and `any()`, an object from `fields()`. */
export type FilesInRequest = FilesObject | File[];

/** Call `callback(null, true)` to accept the file, `callback(null, false)` to skip it, or `callback(error)` to fail the request. */
export type FileFilterCallback = (error: Error | null, acceptFile?: boolean) => void;

/** Decides whether a file is accepted. `request.body` holds the fields that arrived before the file. */
export type FileFilter = (request: FastifyRequest, file: File, callback: FileFilterCallback) => void;

/** Where files go. multer's `diskStorage` and `memoryStorage`, and engines such as multer-s3, all fit. */
export interface StorageEngine {
	_handleFile(request: FastifyRequest, file: File, callback: (error?: Error | null, info?: Partial<File>) => void): void;
	_removeFile(request: FastifyRequest, file: File, callback: (error: Error | null) => void): void;
}

/** Size limits, checked by multer and busboy. Every limit is a non-negative integer or `Infinity`. */
export type Limits = {
	/** Max field name size in bytes. Default 100. */
	fieldNameSize?: number;
	/** Max field value size in bytes. Default 1 MiB. */
	fieldSize?: number;
	/** Max number of non-file fields. Default `Infinity`. */
	fields?: number;
	/** Max file size in bytes. Default `Infinity`. */
	fileSize?: number;
	/** Max number of files. Default `Infinity`. */
	files?: number;
	/** Max number of parts, fields and files together. Default `Infinity`. */
	parts?: number;
	/** Max number of header key/value pairs per part. Default 2000. */
	headerPairs?: number;
	/** Max nesting depth of field names: `a[b][c]` has 2 levels. Default 10 here; multer's own default is `Infinity`. */
	fieldNestingDepth?: number;
	/** Max numeric array index in field names, such as `items[5]`. Default 1000 here; multer's own default is `Infinity`. */
	fieldArrayIndexLimit?: number;
};

export type Options = {
	/** Folder to store files in, with `diskStorage`. */
	dest?: string;
	/** Storage engine. Defaults to `memoryStorage()` when neither `dest` nor `storage` is set. */
	storage?: StorageEngine;
	/** Size limits, or a function of the request that returns them. */
	limits?: Limits | ((request: FastifyRequest) => Limits | undefined);
	/** Keep the full client-supplied path in `file.originalname`. */
	preservePath?: boolean;
	/** Decides which files are accepted. Accepts every file by default. */
	fileFilter?: FileFilter;
	/** Charset for part header parameters, such as the file name, that don't declare one. Default `'latin1'`. */
	defParamCharset?: string;
	/** Charset for text field values that don't declare one. Default `'utf8'`. */
	defCharset?: string;
	/** `highWaterMark` of the multipart parser stream. */
	highWaterMark?: number;
	/** `highWaterMark` of each file stream. */
	fileHwm?: number;
};

export type Field = {
	readonly name: string;
	readonly maxCount?: number;
};

/** A Fastify hook that parses the upload. Use it as a route's `preHandler`, or `preValidation` to validate the parsed body. */
export type UploadHandler = (request: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void;

export type Multer = {
	/** Accept one file in the field `name`, as `request.file`. */
	single(name: string): UploadHandler;
	/** Accept up to `maxCount` files in the field `name`, as `request.files`. */
	array(name: string, maxCount?: number): UploadHandler;
	/** Accept files in each of the named fields, as `request.files[name]`. */
	fields(fields: readonly Field[]): UploadHandler;
	/** Accept text fields only. A file fails the request with `LIMIT_UNEXPECTED_FILE`. */
	none(): UploadHandler;
	/** Accept every file, as `request.files`. Only use it on routes that handle every uploaded file. */
	any(): UploadHandler;
};

/** Every `code` a `MulterError` can have. */
export type MulterErrorCode =
	| 'LIMIT_PART_COUNT'
	| 'LIMIT_FILE_SIZE'
	| 'LIMIT_FILE_COUNT'
	| 'LIMIT_FIELD_KEY'
	| 'LIMIT_FIELD_VALUE'
	| 'LIMIT_FIELD_COUNT'
	| 'LIMIT_UNEXPECTED_FILE'
	| 'MISSING_FIELD_NAME'
	| 'LIMIT_FIELD_NESTING'
	| 'LIMIT_FIELD_ARRAY_INDEX'
	| 'STREAM_DESTROYED'
	| 'INVALID_FIELD_NAME';

/** multer's own error class, so `error instanceof MulterError` works in your error handler. */
export interface MulterError extends Error {
	readonly code: MulterErrorCode;
	/** The field the error relates to. */
	readonly field?: string;
	/** The client-supplied file name, for file errors. */
	readonly filename?: string;
	/** Errors from removing files that were already stored when the upload failed. */
	storageErrors?: Error[];
	/** The HTTP status Fastify replies with: 413 for size and count limits, 400 otherwise. */
	statusCode?: number;
}

export type MulterErrorConstructor = new (code: MulterErrorCode, field?: string, filename?: string) => MulterError;

export type GetDestination = (request: FastifyRequest, file: File, callback: (error: Error | null, destination: string) => void) => void;

export type GetFileName = (request: FastifyRequest, file: File, callback: (error: Error | null, filename: string) => void) => void;

export type DiskStorageOptions = {
	/** Folder for the files, or a function that picks one. Defaults to the OS temp folder. */
	destination?: string | GetDestination;
	/** File name within the folder. Defaults to 16 random bytes in hex, without an extension. */
	filename?: GetFileName;
};

declare module 'fastify' {
	interface FastifyRequest {
		/** The file from `single()`. Only set on routes with an upload handler. */
		file: File;
		/** The files from `array()`, `any()` or `fields()`. Only set on routes with an upload handler. */
		files: FilesInRequest;
		/** Whether the request body is `multipart/form-data` and waiting to be parsed. */
		isMultipart: () => boolean;
	}
}
