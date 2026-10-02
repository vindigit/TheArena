// Presentation switch for before/after review: ?look=old keeps the original
// camera, lighting and uniform; anything else uses the visual-pass look.
export const LOOK = new URLSearchParams(globalThis.location?.search || '').get('look') === 'old' ? 'old' : 'new';
export default LOOK;
