// @createcms/react/media/next-loader: a Next.js `images.loaderFile`. Set
// `images.deviceSizes` and `images.imageSizes` to the rendition widths so
// Next asks for those widths only; any other width snaps up to the next one.
import { createImageLoader } from './image';

export default createImageLoader();
