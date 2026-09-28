/** esbuild loads a .gz file as its bytes (see the build script). */
declare module '*.gz' {
  const bytes: Uint8Array;
  export default bytes;
}

/** The files in public/, built in by scripts/build.mjs: path to content type and base64 body. */
declare module 'virtual:pages' {
  const pages: Record<string, { type: string; body: string }>;
  export default pages;
}
