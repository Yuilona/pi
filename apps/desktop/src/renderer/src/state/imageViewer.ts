import { createContext, useContext } from "react";

/** Opens a full-screen preview of an image (by data URL). Provided at the App root; consumed by any bubble
 * that renders an image so a sent attachment can be clicked to enlarge. */
export const ImageViewerContext = createContext<(src: string) => void>(() => {});

export const useImageViewer = () => useContext(ImageViewerContext);
