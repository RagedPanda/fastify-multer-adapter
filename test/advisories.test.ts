// Runs payloads from multer's 2026 security advisories against this adapter (over multer 2.5.0)
// and, for comparison, against fastify-multer 2.0.3, which vendors the multer 1.x parsing code.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import multer, {type Limits} from '../src/index.ts';
import {createApp, multipartBody, multipartHeaders, postMultipart, type Part} from './helpers.ts';

const fields = (...names: string[]): Part[] => names.map(name => ({name, value: 'x'}));

/** GHSA-wc9g-mqfw-jrwm: two field names that make append-field throw `RangeError: Invalid array length`. */
const crashingFields = fields('a[4294967294]', 'a[]');

/** GHSA-535w-7cp7-47q4: a huge array index, then a named key that turns the array into an object. */
const blockingFields = fields('items[4294967294]', 'items[x]');

/** GHSA-72gw-mp4g-v24j: deeply nested field names. */
const nestedFields = fields(`a${'[b]'.repeat(30)}`);

const appWithLimits = (limits?: Limits) => {
	const app = createApp();
	app.post('/', {preHandler: multer(limits === undefined ? {} : {limits}).none()}, async request => ({fields: Object.keys(request.body as object).length}));
	return app;
};

test('GHSA-wc9g: fastify-multer 2.0.3 crashes the process', () => {
	const fixture = fileURLToPath(new URL('fixtures/fastify-multer-v4.cjs', import.meta.url));
	const child = spawnSync(process.execPath, [fixture, multipartHeaders['content-type']], {input: multipartBody(crashingFields), encoding: 'utf8'});
	assert.notEqual(child.status, 0);
	assert.match(child.stderr, /RangeError: Invalid array length/);
	assert.equal(child.stdout, '');
});

test('GHSA-wc9g: the adapter replies 400 and keeps serving', async () => {
	// fieldArrayIndexLimit: Infinity turns off the adapter's default, to show multer's own fix.
	const app = appWithLimits({fieldArrayIndexLimit: Infinity});
	const response = await postMultipart(app, '/', crashingFields);
	assert.equal(response.statusCode, 400);
	assert.equal(response.json().code, 'INVALID_FIELD_NAME');
	assert.equal((await postMultipart(app, '/', fields('ok'))).statusCode, 200);
});

test('GHSA-535w: the adapter rejects a huge array index by default', async () => {
	const started = performance.now();
	const response = await postMultipart(appWithLimits(), '/', blockingFields);
	assert.equal(response.statusCode, 400);
	assert.equal(response.json().code, 'LIMIT_FIELD_ARRAY_INDEX');
	assert.ok(performance.now() - started < 1000);
});

test('GHSA-72gw: the adapter rejects deeply nested field names by default', async () => {
	const response = await postMultipart(appWithLimits(), '/', nestedFields);
	assert.equal(response.statusCode, 400);
	assert.equal(response.json().code, 'LIMIT_FIELD_NESTING');
});
