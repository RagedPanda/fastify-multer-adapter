/** Whether a Content-Type header names any multipart type, which is what multer itself checks for. */
export const isMultipartType = (contentType: string | undefined): contentType is string =>
	contentType !== undefined && /^\s*multipart\//i.test(contentType);

/** Whether a multipart Content-Type header has a non-empty `boundary` parameter, which busboy needs. */
export const hasBoundary = (contentType: string): boolean => /;\s*boundary\s*=\s*(?:"[^"]+"|[^\s;"]+)/i.test(contentType);
