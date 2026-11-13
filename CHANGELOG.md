# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Releases are published through npm trusted publishing (OIDC) instead of an npm token, so there is no long-lived token that could leak and publish a malicious version.

## [0.1.0] - 2026-11-13

### Added

- `multer(options)` with `single()`, `array()`, `fields()`, `none()` and `any()` upload handlers that run the official multer 2.5 on Fastify 5 routes, as `preHandler` or `preValidation` hooks.
- `multer.contentParser`, a Fastify 5 content type parser for `multipart/form-data` that leaves the body for multer to read, plus `request.isMultipart()`.
- `request.file`, `request.files` and `request.body` typed like fastify-multer, so moving from fastify-multer is an import change.
- `fileFilter`, storage engines and a `limits` function receive the Fastify request, so they can read `request.user`, `request.id` and other decorations.
- Upload errors carry an HTTP status: 413 for size and count limits, 400 for other `MulterError`s, malformed bodies and closed connections.
- `fieldNestingDepth` defaults to 10 and `fieldArrayIndexLimit` to 1000, which blocks the field-name payloads of GHSA-72gw-mp4g-v24j and GHSA-535w-7cp7-47q4 out of the box.
- Clear errors instead of hangs when an `onRequest` hook already read the body or the client closed the connection before the upload started.
- ESM and CommonJS builds, each with its own types.

[Unreleased]: https://github.com/RagedPanda/fastify-multer-adapter/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/RagedPanda/fastify-multer-adapter/releases/tag/v0.1.0
