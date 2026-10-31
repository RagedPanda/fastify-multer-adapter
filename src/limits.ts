import type {Limits} from './types.ts';

/**
 * Limits multer leaves unbounded by default, though an unbounded value lets one request tie up
 * the process (GHSA-535w-7cp7-47q4, GHSA-72gw-mp4g-v24j). The adapter turns them on unless you
 * set them yourself; pass `Infinity` to get multer's default back.
 */
export const defaultLimits = {
	/** `items[1000]` is accepted, `items[1001]` is not. */
	fieldArrayIndexLimit: 1000,
	/** `a[b][c]` has a depth of 2. */
	fieldNestingDepth: 10,
} as const satisfies Limits;

/** The limits to give multer: the defaults above, overridden by whatever the app set. */
export const withDefaultLimits = (limits: Limits | undefined): Limits => ({...defaultLimits, ...limits});
