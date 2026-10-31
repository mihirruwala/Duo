// Document Picture-in-Picture (Chrome 116+), not yet in TypeScript's DOM lib.
interface DocumentPictureInPicture extends EventTarget {
  readonly window: Window | null;
  requestWindow(options?: {
    width?: number;
    height?: number;
    disallowReturnToOpener?: boolean;
    preferInitialWindowPlacement?: boolean;
  }): Promise<Window>;
}

interface Window {
  readonly documentPictureInPicture?: DocumentPictureInPicture;
}
