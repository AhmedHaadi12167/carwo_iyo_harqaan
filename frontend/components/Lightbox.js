'use client';

// Full-screen image viewer. Pass `src` (falsy = closed) and `onClose`.
// Click the backdrop, the image itself, or the × to close.
export default function Lightbox({ src, alt, onClose }) {
  if (!src) return null;
  return (
    <div
      className="fixed inset-0 bg-black/85 flex items-center justify-center z-[100] p-4 cursor-zoom-out"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white text-2xl leading-none flex items-center justify-center"
        aria-label="Close"
      >
        &times;
      </button>
      <img
        src={src}
        alt={alt || 'Fabric'}
        className="max-w-full max-h-full rounded-xl shadow-2xl object-contain"
      />
    </div>
  );
}
