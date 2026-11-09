// The quality tiers a clipping can carry, in order from best to weakest. Every clipper's command-line check
// (lib/clip-args.mjs), adopt-clipping.mjs, known-urls.mjs --summary and the selective GitHub capture read this one list.
export const QUALITY_TIERS = Object.freeze(['high', 'medium', 'low']);
