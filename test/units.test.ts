import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hasBoundary, isMultipartType} from '../src/content-type.ts';
import {bodyAlreadyReadError, missingBoundaryError, requestClosedError, statusCodeFor, statusCodeForMulterCode, withStatusCode} from '../src/errors.ts';
import {defaultLimits, withDefaultLimits} from '../src/limits.ts';

test('isMultipartType matches every multipart type and nothing else', () => {
	assert.equal(isMultipartType('multipart/form-data; boundary=x'), true);
	assert.equal(isMultipartType(' Multipart/Mixed'), true);
	assert.equal(isMultipartType('application/json'), false);
	assert.equal(isMultipartType(undefined), false);
});

test('hasBoundary needs a non-empty boundary parameter', () => {
	assert.equal(hasBoundary('multipart/form-data; boundary=abc'), true);
	assert.equal(hasBoundary('multipart/form-data;BOUNDARY="a b"'), true);
	assert.equal(hasBoundary('multipart/form-data'), false);
	assert.equal(hasBoundary('multipart/form-data; boundary='), false);
	assert.equal(hasBoundary('multipart/form-data; boundary=""'), false);
});

test('size and count limits are 413, every other multer code 400', () => {
	for (const code of ['LIMIT_PART_COUNT', 'LIMIT_FILE_SIZE', 'LIMIT_FILE_COUNT', 'LIMIT_FIELD_KEY', 'LIMIT_FIELD_VALUE', 'LIMIT_FIELD_COUNT']) {
		assert.equal(statusCodeForMulterCode(code), 413, code);
	}

	for (const code of ['LIMIT_UNEXPECTED_FILE', 'MISSING_FIELD_NAME', 'LIMIT_FIELD_NESTING', 'LIMIT_FIELD_ARRAY_INDEX', 'STREAM_DESTROYED', 'INVALID_FIELD_NAME', 'SOMETHING_NEW']) {
		assert.equal(statusCodeForMulterCode(code), 400, code);
	}
});

test('statusCodeFor leaves server errors to Fastify', () => {
	const error = Object.assign(new Error('x'), {code: 'LIMIT_FILE_SIZE'});
	assert.equal(statusCodeFor(error, 'multer'), 413);
	assert.equal(statusCodeFor(error, 'client'), 400);
	assert.equal(statusCodeFor(error, 'server'), undefined);
});

test('withStatusCode keeps the error object and an existing status', () => {
	const error = new Error('x');
	assert.equal(withStatusCode(error, 400), error);
	assert.equal((error as {statusCode?: number}).statusCode, 400);
	assert.equal((withStatusCode(error, 413) as {statusCode?: number}).statusCode, 400);
	assert.equal('statusCode' in withStatusCode(new Error('y'), undefined), false);
});

test('adapter errors carry the code and status Fastify replies with', () => {
	assert.deepEqual(
		[missingBoundaryError(), bodyAlreadyReadError(), requestClosedError()].map(error => [(error as {code?: string}).code, (error as {statusCode?: number}).statusCode]),
		[['FST_MULTER_MISSING_BOUNDARY', 400], ['FST_MULTER_BODY_ALREADY_READ', 500], ['FST_MULTER_REQUEST_CLOSED', 400]],
	);
});

test('withDefaultLimits fills in the unbounded limits, and the app can override them', () => {
	assert.deepEqual(withDefaultLimits(undefined), defaultLimits);
	assert.deepEqual(withDefaultLimits({fileSize: 10, fieldArrayIndexLimit: Infinity}), {fieldArrayIndexLimit: Infinity, fieldNestingDepth: 10, fileSize: 10});
});
