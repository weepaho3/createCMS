declare module '@jsquash/webp' {
  export function encode(
    imageData: ImageData,
    options?: { quality?: number },
  ): Promise<ArrayBuffer>;

  export function decode(buffer: ArrayBuffer): Promise<ImageData>;
}
