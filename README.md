# fastify-multer-adapter

[![npm version](https://img.shields.io/npm/v/fastify-multer-adapter)](https://www.npmjs.com/package/fastify-multer-adapter)
[![CI](https://github.com/RagedPanda/fastify-multer-adapter/actions/workflows/ci.yml/badge.svg)](https://github.com/RagedPanda/fastify-multer-adapter/actions/workflows/ci.yml)
[![coverage](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/RagedPanda/fastify-multer-adapter/actions/workflows/ci.yml)
[![types](https://img.shields.io/npm/types/fastify-multer-adapter)](https://www.npmjs.com/package/fastify-multer-adapter)
[![fastify](https://img.shields.io/npm/dependency-version/fastify-multer-adapter/peer/fastify)](https://fastify.dev)
[![multer](https://img.shields.io/npm/dependency-version/fastify-multer-adapter/peer/multer)](https://github.com/expressjs/multer)
[![license](https://img.shields.io/npm/l/fastify-multer-adapter)](LICENSE)

Use the official [multer](https://github.com/expressjs/multer), with its security fixes and its storage engines, as Fastify 5 route hooks. A drop-in replacement for [fastify-multer](https://github.com/fox1t/fastify-multer).

```ts
import Fastify from 'fastify';
import multer from 'fastify-multer-adapter';

const app = Fastify();
const upload = multer({dest: 'uploads/', limits: {fileSize: 10 * 1024 * 1024}});

app.register(multer.contentParser);
app.post('/profile', {preHandler: upload.single('avatar')}, async request => {
	return {savedTo: request.file.path, fields: request.body};
});
```

## Why

Express apps upload files with multer. Fastify apps that wanted the same API, the same storage engines (disk, memory, [multer-s3](https://github.com/anacronw/multer-s3), Cloudinary and so on) and the same `request.file` used **fastify-multer**. Today that fails in two ways:

- **It does not load on Fastify 5.** It registers its parser with `addContentTypeParser('multipart', ...)`, which Fastify 5 rejects at startup with `FST_ERR_CTP_INVALID_TYPE` ([fastify-multer#38](https://github.com/fox1t/fastify-multer/issues/38)). Its last release, 2.0.3, came out in 2022.
- **It carries old multer code.** It vendors the multer 1.x parser, so none of multer's 2026 security fixes reach it. Feeding it the payload from [GHSA-wc9g-mqfw-jrwm](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm) crashes the whole Node.js process (see [Security](#security)).

The usual ways out each cost something:

- **Use multer directly** with `@fastify/express` or `@fastify/middie`. That adds an Express compatibility layer, and multer then sees the raw Node.js request: `fileFilter` and storage engines can't read `request.user` or anything else your Fastify hooks set, and errors skip Fastify's error handling.
- **Switch to [@fastify/multipart](https://github.com/fastify/fastify-multipart).** It is fast and well kept, but its API is different (`await request.file()`, async iterators, its own storage handling), so every route and every storage engine needs rewriting.
- **Patch fastify-multer** to register `'multipart/form-data'`. It starts, but it still runs the vulnerable parser.

fastify-multer-adapter is a thin layer over the official multer. It registers a Fastify 5 content type parser that leaves the body unread, then runs multer itself on the request stream inside a route hook and copies `file`, `files` and `body` onto the Fastify request. Every fix multer ships reaches you with `npm update multer`.

## Install

```sh
npm install fastify-multer-adapter multer
```

`fastify` (5.x) and `multer` (2.5.0 or later in 2.x) are peer dependencies, so you choose their versions. The package has no other dependencies.

## Usage

Register the content parser once, at the level where uploads should be accepted, then add an upload handler to each route that takes files.

```ts
import Fastify from 'fastify';
import multer from 'fastify-multer-adapter';

const app = Fastify();
await app.register(multer.contentParser);
```

```js
// CommonJS
const {multer} = require('fastify-multer-adapter');
```

### One file

```ts
const upload = multer({dest: 'uploads/'});

app.post('/avatar', {preHandler: upload.single('avatar')}, async request => {
	request.file; // {fieldname, originalname, mimetype, size, destination, filename, path, ...}
	request.body; // the text fields
});
```

### Several files in one field, or in several fields

```ts
import type {File} from 'fastify-multer-adapter';

app.post('/gallery', {preHandler: upload.array('photos', 12)}, async request => {
	const photos = request.files as File[];
});

app.post('/listing', {
	preHandler: upload.fields([{name: 'cover', maxCount: 1}, {name: 'photos', maxCount: 8}]),
}, async request => {
	const {cover, photos} = request.files as Record<string, File[]>;
});
```

`request.files` is an array for `array()` and `any()` and an object of arrays for `fields()`, as in multer, so narrow it with `as`.

### Text fields only, or anything

```ts
app.post('/contact', {preHandler: upload.none()}, async request => request.body);
app.post('/import', {preHandler: upload.any()}, async request => request.files);
```

`none()` fails the request with `LIMIT_UNEXPECTED_FILE` if a file arrives. Use `any()` only on routes that handle every file they get.

### Storage

```ts
import {diskStorage, memoryStorage} from 'fastify-multer-adapter';

// Files in memory, as file.buffer. This is also the default when neither dest nor storage is set.
const inMemory = multer({storage: memoryStorage(), limits: {fileSize: 5 * 1024 * 1024}});

// Files on disk, with the folder and name chosen per request.
const onDisk = multer({
	storage: diskStorage({
		destination: (request, file, callback) => callback(null, `uploads/${request.user.id}`),
		filename: (request, file, callback) => callback(null, `${request.id}-${file.originalname}`),
	}),
});
```

Any multer storage engine works, such as `multer-s3`. Its `_handleFile` and `_removeFile` receive the Fastify request.

### Choosing files

```ts
const images = multer({
	fileFilter: (request, file, callback) => {
		if (!file.mimetype.startsWith('image/')) {
			return callback(Object.assign(new Error('Only images, please'), {statusCode: 415}));
		}

		callback(null, true);
	},
});
```

`fileFilter` receives the Fastify request. `request.body` already holds the fields sent before the file, so put fields first in your form if the filter needs them.

### Limits

```ts
multer({limits: {fileSize: 10 * 1024 * 1024, files: 5, fields: 20}});

// Or per request:
multer({limits: request => (request.user?.plan === 'pro' ? {fileSize: 1024 ** 3} : {fileSize: 10 * 1024 ** 2})});
```

### Validating the body with a schema

Fastify validates the body before `preHandler` runs, when it is still empty. To validate the parsed fields, run the upload in `preValidation` instead:

```ts
app.post('/posts', {
	preValidation: upload.single('cover'),
	schema: {body: {type: 'object', required: ['title'], properties: {title: {type: 'string', maxLength: 200}}}},
}, async request => request.body);
```

### Errors

Upload failures reach your error handler with an HTTP status already set, so Fastify's default handler replies correctly:

| Failure | Status | `code` |
| --- | --- | --- |
| A size or count limit was hit | 413 | `LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_FIELD_KEY`, `LIMIT_FIELD_VALUE`, `LIMIT_FIELD_COUNT`, `LIMIT_PART_COUNT` |
| Any other `MulterError` (unexpected field, bad field name, nesting and so on) | 400 | `LIMIT_UNEXPECTED_FILE`, `INVALID_FIELD_NAME`, `LIMIT_FIELD_NESTING`, ... |
| Malformed body, or the client went away mid-upload | 400 | busboy's or Node.js's error, such as "Unexpected end of form" |
| `multipart/form-data` without a `boundary` | 400 | `FST_MULTER_MISSING_BOUNDARY` |
| The client closed the connection before the upload started | 400 | `FST_MULTER_REQUEST_CLOSED` |
| Something already read the request body | 500 | `FST_MULTER_BODY_ALREADY_READ` |
| Storage engine or `fileFilter` error | its own `statusCode`, else 500 | its own |

```ts
import {MulterError} from 'fastify-multer-adapter';

app.setErrorHandler((error, request, reply) => {
	if (error instanceof MulterError) {
		return reply.status(error.statusCode ?? 400).send({message: `Upload rejected: ${error.code}`});
	}

	return reply.send(error);
});
```

When an upload fails, files that were already stored are removed, as multer does.

## Migrating from fastify-multer

Change the import and install multer. Routes, `request.file`, `request.files`, storage engines, `fileFilter` and `multer.contentParser` stay as they are.

```diff
- import multer from 'fastify-multer';
+ import multer from 'fastify-multer-adapter';
```

```diff
- const multer = require('fastify-multer');
+ const {multer} = require('fastify-multer-adapter');
```

```diff
  "dependencies": {
-   "fastify-multer": "^2.0.3",
+   "fastify-multer-adapter": "^0.1.0",
+   "multer": "^2.5.0",
    "fastify": "^5.0.0"
  }
```

Things that behave differently:

- **Errors have a status.** A `MulterError` from fastify-multer had no `statusCode`, so Fastify replied 500. Now limits reply 413 and other upload errors 400. Check any error handler that relied on 500.
- **Two limits are on by default.** `fieldNestingDepth` is 10 and `fieldArrayIndexLimit` is 1000 (see [Security](#security)). Pass `Infinity` to turn either off.
- **The multer version is yours.** `multer` is a peer dependency, so `npm update multer` brings in its fixes without a new release of this package.

## API

### `multer(options?)`

Returns an object with five upload handlers. Each is a Fastify hook for `preHandler` or `preValidation`, and does nothing on requests that aren't `multipart/form-data`.

| Method | Puts files in |
| --- | --- |
| `single(name)` | `request.file` |
| `array(name, maxCount?)` | `request.files` (array) |
| `fields([{name, maxCount?}, ...])` | `request.files` (object of arrays) |
| `none()` | nowhere: a file fails the request |
| `any()` | `request.files` (array) |

Options:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dest` | `string` | | Folder for files, with disk storage. |
| `storage` | `StorageEngine` | `memoryStorage()` | Where files go. Takes precedence over `dest`. |
| `limits` | `Limits \| (request) => Limits` | see below | Size limits, or a function of the request that returns them. |
| `fileFilter` | `(request, file, callback) => void` | accept all | Accept (`callback(null, true)`), skip (`callback(null, false)`) or reject (`callback(error)`) each file. |
| `preservePath` | `boolean` | `false` | Keep the full client path in `file.originalname`. |
| `defParamCharset` | `string` | `'latin1'` | Charset of part header parameters, such as the file name, that don't declare one. |
| `defCharset` | `string` | `'utf8'` | Charset of text fields that don't declare one. |
| `highWaterMark`, `fileHwm` | `number` | | Buffer sizes of the parser and of each file stream. |

`limits`, all non-negative integers or `Infinity`:

| Limit | Default | Description |
| --- | --- | --- |
| `fileSize` | `Infinity` | Max bytes per file. |
| `files` | `Infinity` | Max number of files. |
| `fields` | `Infinity` | Max number of text fields. |
| `parts` | `Infinity` | Max number of fields and files together. |
| `fieldSize` | 1 MiB | Max bytes per text field value. |
| `fieldNameSize` | 100 | Max bytes per field name. |
| `headerPairs` | 2000 | Max header pairs per part. |
| `fieldNestingDepth` | **10** (multer: `Infinity`) | Max nesting of field names: `a[b][c]` is 2. |
| `fieldArrayIndexLimit` | **1000** (multer: `Infinity`) | Max array index in field names, such as `items[5]`. |

### `multer.contentParser` (also exported as `contentParser`)

A Fastify plugin that registers a `multipart/form-data` parser which keeps the body stream for the upload handlers, and decorates the request with `isMultipart()`. It follows Fastify's encapsulation like any other content type parser: register it at the root to accept uploads everywhere, or inside a plugin to accept them only on that plugin's routes.

### `diskStorage({destination?, filename?})`, `memoryStorage()`

multer's storage engines, also available as `multer.diskStorage` and `multer.memoryStorage`. Their callbacks receive the Fastify request.

### `MulterError`

multer's error class, also available as `multer.MulterError`. Its instances have `code`, `field`, and `statusCode` as described under [Errors](#errors).

### `request.file`, `request.files`, `request.isMultipart()`

Added to `FastifyRequest` by the package's types, the same way fastify-multer did. `file` and `files` are typed as always present, as in fastify-multer, but they are only set on routes with an upload handler.

### Types

`File`, `FilesObject`, `FilesInRequest`, `FileFilter`, `FileFilterCallback`, `StorageEngine`, `Limits`, `Options`, `Field`, `Multer`, `UploadHandler`, `MulterErrorCode`, `MulterErrorConstructor`, `DiskStorageOptions`, `GetDestination` and `GetFileName`. `File` is an interface, so a storage engine that adds properties can extend it:

```ts
declare module 'fastify-multer-adapter' {
	interface File {
		location?: string; // from multer-s3
	}
}
```

## Security

multer published 11 security advisories in 2026, all fixed by 2.5.0, the oldest version this package accepts. fastify-multer 2.0.3 vendors multer 1.x code, so none of those fixes reach it, though not every advisory applies to the code it copied. The table lists only what was actually run. Each payload below was run against fastify-multer 2.0.3 on Fastify 4.29.1, its last working setup, and against this package on Fastify 5.12.7 with multer 2.5.0, on Node.js 24.17.0. The checks are in [`test/advisories.test.ts`](test/advisories.test.ts).

| Advisory | Payload | fastify-multer 2.0.3 | multer 2.5.0 defaults | fastify-multer-adapter defaults |
| --- | --- | --- | --- | --- |
| [GHSA-wc9g-mqfw-jrwm](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm), crash | fields `a[4294967294]` then `a[]` | **Process exits** with `RangeError: Invalid array length` | 400 `INVALID_FIELD_NAME` in 9 ms | 400 `LIMIT_FIELD_ARRAY_INDEX` |
| [GHSA-535w-7cp7-47q4](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4), CPU | fields `items[4294967294]` then `items[x]` | 200 after **55 s** with the event loop blocked | 200 after **56 s** with the event loop blocked | 400 `LIMIT_FIELD_ARRAY_INDEX` in under 3 ms |
| [GHSA-72gw-mp4g-v24j](https://github.com/expressjs/multer/security/advisories/GHSA-72gw-mp4g-v24j), nesting | `a` followed by 50,000 `[b]` | 200 in 23 ms: not reproduced, the 100-byte default `fieldNameSize` cuts the name short | 200 for 30 levels | 400 `LIMIT_FIELD_NESTING` |
| [GHSA-qvfw-j98x-7q72](https://github.com/expressjs/multer/security/advisories/GHSA-qvfw-j98x-7q72), async `fileFilter` skips `fileSize` | | not tested | fixed in multer 2.3.0 | fixed (multer 2.5.0) |

multer fixed the CPU and nesting advisories by adding the `fieldArrayIndexLimit` and `fieldNestingDepth` limits, but both default to `Infinity`, so an app that doesn't set them is still open to the 56-second block. That's why this package sets them to 1000 and 10. A form that needs deeper names or bigger indexes can raise them.

## Benchmarks

The time each library spends parsing the same upload, with the file kept in memory: multer's `memoryStorage()` for this package and fastify-multer, `part.toBuffer()` over `request.parts()` for @fastify/multipart. fastify-multer runs on Fastify 4 because it can't start on Fastify 5. Each run sends 2,000 requests one after another through `app.inject()`, so there are no sockets in the way; the table shows the median of 7 runs after 2 warmups.

Node.js 24.17.0, Apple M5 (10 cores), macOS (Darwin 27.0.0):

| Upload | fastify-multer-adapter (Fastify 5) | fastify-multer 2.0.3 (Fastify 4) | @fastify/multipart 10.1.6 (Fastify 5) |
| --- | ---: | ---: | ---: |
| 10 text fields, no file | 16,168 req/s | 15,505 req/s | 16,189 req/s |
| 1 file of 10 KB + 3 fields | 20,575 req/s | 17,276 req/s | 17,755 req/s |
| 1 file of 1 MB | 9,351 req/s | 9,168 req/s | 10,798 req/s |
| 5 files of 100 KB | 10,258 req/s | 9,955 req/s | 11,387 req/s |

The adapter is as fast as fastify-multer or faster. @fastify/multipart is 10 to 15% faster on large files. The adapter's own cost is a few function calls per request, so the difference comes from multer and busboy. Rerun it with:

```sh
npm run bench
BENCH_REQUESTS=500 BENCH_RUNS=5 npm run bench
```

## Good to know

- **Fastify's `bodyLimit` does not apply.** Fastify can't count the bytes multer reads, so set `limits.fileSize`, `files`, `fields` and `parts`. multer's `fileSize` is unlimited by default.
- **Only `multipart/form-data` is parsed.** Other `multipart/*` types get Fastify's usual 415.
- **Don't read the body in an `onRequest` hook.** If a hook already consumed `request.raw`, there is nothing left for multer, and the request fails with a 500 `FST_MULTER_BODY_ALREADY_READ` rather than hanging. Streams returned from `preParsing` hooks (to decompress, for example) work.
- **Clients that disconnect.** Files already stored are removed and the request settles with a 400. Node.js only notices that a client left once the body is read, so a slow `preValidation` or `preHandler` before the upload handler finishes first.
- **`request.file` and `request.files` are typed as always present**, to match fastify-multer. They're `undefined` on routes without an upload handler.
- **Not together with @fastify/multipart's types.** Both packages add `request.file` to `FastifyRequest` with different types, so TypeScript reports a conflict if one project imports both.
- **Fastify's `addContentTypeParser` encapsulation applies.** Routes outside the scope where `contentParser` is registered reply 415 to uploads.

## Related

- [multer](https://github.com/expressjs/multer): the upload middleware for Express that this package runs.
- [@fastify/multipart](https://github.com/fastify/fastify-multipart): Fastify's own multipart plugin, with an async API.
- [fastify-multer](https://github.com/fox1t/fastify-multer): the original multer port for Fastify 3 and 4.
- [busboy](https://github.com/mscdex/busboy): the multipart parser under multer.

## License

MIT
