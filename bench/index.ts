// Compares fastify-multer-adapter with fastify-multer (on Fastify 4, the last major it loads on)
// and @fastify/multipart, each keeping the uploaded file in memory.
//
//   npm run bench
//   BENCH_REQUESTS=500 BENCH_RUNS=5 npm run bench
//
// Each run sends the same requests one after another through `app.inject()`, so the numbers
// measure the server-side cost of parsing, with no sockets or network in the way.
// The median requests per second of the timed runs is reported.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import Fastify from 'fastify';
import multer from '../src/index.ts';
import {multipartBody, multipartHeaders, type Part} from '../test/helpers.ts';

const requestCount = Number(process.env['BENCH_REQUESTS'] ?? 2000);
const runs = Number(process.env['BENCH_RUNS'] ?? 7);
const warmups = 2;

/** The smallest surface the benchmark needs from any Fastify version. */
type App = {
	readonly inject: (options: {method: string; url: string; headers: Record<string, string>; payload: Buffer}) => Promise<{statusCode: number; body: string}>;
	readonly ready: () => PromiseLike<unknown>;
	readonly close: () => PromiseLike<unknown>;
};

/** What every route answers, so each library is checked to have parsed the same thing. */
type Summary = {readonly fields: number; readonly bytes: number};

// Loaded with require so that @fastify/multipart's type augmentation of FastifyRequest stays out of this project.
const require = createRequire(import.meta.url);

const adapterApp = async (): Promise<App> => {
	const app = Fastify();
	await app.register(multer.contentParser);
	const upload = multer({storage: multer.memoryStorage()}).any();
	app.post('/', {preHandler: upload}, async request => summarize(request.body, request.files as {buffer?: Buffer}[]));
	return app;
};

const fastifyMulterApp = async (): Promise<App> => {
	const fastify4 = require('fastify4') as (options?: object) => any;
	const fastifyMulter = require('fastify-multer') as any;
	const app = fastify4();
	await app.register(fastifyMulter.contentParser);
	const upload = fastifyMulter({storage: fastifyMulter.memoryStorage()}).any();
	app.post('/', {preHandler: upload}, async (request: any) => summarize(request.body, request.files));
	return app;
};

const fastifyMultipartApp = async (): Promise<App> => {
	const fastifyMultipart = require('@fastify/multipart') as any;
	const app = Fastify() as any;
	await app.register(fastifyMultipart);
	app.post('/', async (request: any) => {
		const fields: Record<string, unknown> = {};
		const files: {buffer: Buffer}[] = [];
		for await (const part of request.parts()) {
			if (part.type === 'file') {
				files.push({buffer: await part.toBuffer()});
			} else {
				fields[part.fieldname] = part.value;
			}
		}

		return summarize(fields, files);
	});
	return app;
};

const summarize = (body: unknown, files: readonly {buffer?: Buffer}[]): Summary => ({
	fields: Object.keys(body as object).length,
	bytes: files.reduce((total, file) => total + (file.buffer?.length ?? 0), 0),
});

type Scenario = {readonly name: string; readonly parts: readonly Part[]};

const fields = (count: number): Part[] => Array.from({length: count}, (_, index) => ({name: `field${index}`, value: `value ${index}`}));
const file = (name: string, bytes: number): Part => ({name, filename: `${name}.bin`, content: Buffer.alloc(bytes, 7), type: 'application/octet-stream'});

const scenarios: readonly Scenario[] = [
	{name: '10 text fields, no file', parts: fields(10)},
	{name: '1 file of 10 KB + 3 fields', parts: [...fields(3), file('avatar', 10 * 1024)]},
	{name: '1 file of 1 MB', parts: [file('video', 1024 * 1024)]},
	{name: '5 files of 100 KB', parts: Array.from({length: 5}, (_, index) => file(`photo${index}`, 100 * 1024))},
];

const libraries: readonly {readonly name: string; readonly create: () => Promise<App>}[] = [
	{name: 'fastify-multer-adapter (Fastify 5)', create: adapterApp},
	{name: 'fastify-multer 2.0.3 (Fastify 4)', create: fastifyMulterApp},
	{name: '@fastify/multipart (Fastify 5)', create: fastifyMultipartApp},
];

const median = (values: readonly number[]): number => {
	const sorted = values.toSorted((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

const expectedSummary = (parts: readonly Part[]): Summary => ({
	fields: parts.filter(part => !('filename' in part)).length,
	bytes: parts.reduce((total, part) => total + ('filename' in part ? part.content.length : 0), 0),
});

/** Sends `requestCount` requests one after another and returns requests per second. */
const timeRun = async (app: App, payload: Buffer, expected: string): Promise<number> => {
	const start = performance.now();
	for (let index = 0; index < requestCount; index++) {
		const response = await app.inject({method: 'POST', url: '/', headers: multipartHeaders, payload});
		assert.equal(response.body, expected);
	}

	return requestCount / ((performance.now() - start) / 1000);
};

const measure = async (create: () => Promise<App>, scenario: Scenario): Promise<number> => {
	const app = await create();
	await app.ready();
	try {
		const payload = multipartBody(scenario.parts);
		const expected = JSON.stringify(expectedSummary(scenario.parts));
		const rates = [];
		for (let run = 0; run < warmups + runs; run++) {
			const rate = await timeRun(app, payload, expected);
			if (run >= warmups) {
				rates.push(rate);
			}
		}

		return median(rates);
	} finally {
		await app.close();
	}
};

console.log(`Node.js ${process.version}, ${os.cpus()[0]?.model ?? os.arch()} (${os.cpus().length} cores), ${os.platform()} ${os.release()}`);
console.log(`${requestCount.toLocaleString('en')} sequential requests per run through app.inject(), median of ${runs} runs after ${warmups} warmups\n`);
console.log(`| Upload | ${libraries.map(library => library.name).join(' | ')} |`);
console.log(`| --- |${libraries.map(() => ' ---: |').join('')}`);
for (const scenario of scenarios) {
	const rates = [];
	for (const library of libraries) {
		rates.push(await measure(library.create, scenario));
	}

	console.log(`| ${scenario.name} | ${rates.map(rate => `${Math.round(rate).toLocaleString('en')} req/s`).join(' | ')} |`);
}
