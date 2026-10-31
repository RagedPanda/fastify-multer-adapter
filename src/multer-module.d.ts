// The parts of the official multer this adapter calls. multer ships no types of its own, and
// @types/multer pulls in Express, so the adapter declares what it uses here. This file is not
// published: the public types in types.ts don't refer to it.
declare module 'multer' {
	import type {IncomingMessage, ServerResponse} from 'node:http';
	import type {Writable} from 'node:stream';

	namespace multer {
		type Callback = (error?: unknown) => void;
		type Middleware = (request: IncomingMessage, response: ServerResponse, next: Callback) => void;
		type RawStorageEngine = {
			_handleFile(request: IncomingMessage, file: object, callback: (error?: Error | null, info?: object) => void): void;
			_removeFile(request: IncomingMessage, file: object, callback: (error: Error | null) => void): void;
		};
		type RawOptions = {
			readonly [key: string]: unknown;
			readonly streamHandler: (request: IncomingMessage, busboy: Writable) => void;
		};
		type Instance = {
			single(name: string): Middleware;
			array(name: string, maxCount?: number): Middleware;
			fields(fields: ReadonlyArray<{readonly name: string; readonly maxCount?: number}>): Middleware;
			none(): Middleware;
			any(): Middleware;
		};
		type RawFileFilter = (request: IncomingMessage, file: object, callback: (error: Error | null, acceptFile?: boolean) => void) => void;
		const diskStorage: unknown;
		const memoryStorage: unknown;
		const MulterError: new (code: string, field?: string, filename?: string) => Error & {code: string};
	}

	function multer(options: multer.RawOptions): multer.Instance;
	export = multer;
}
