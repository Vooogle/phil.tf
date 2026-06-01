import noiseGenerator    from './noise-generator.js';
import tileGenerator     from './tile-generator.js';
import tldList           from './tld-list.js';
import imageConverter    from './image-converter.js';
import audioConverter    from './audio-converter.js';
import videoConverter    from './video-converter.js';
// import documentConverter from './document-converter.js';
import videoEditor       from './video-editor.js';
import videoCompressor   from './video-compressor.js';

// Add new tools here — order determines sidebar order within categories
export const tools = [
  noiseGenerator,
  tileGenerator,
  tldList,
  imageConverter,
  audioConverter,
  videoConverter,
  videoEditor,
  videoCompressor,
  // documentConverter,
];
