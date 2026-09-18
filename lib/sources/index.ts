import { federalRegisterAdapter } from "./federal-register";
import { lawGoKrAdapter } from "./law-go-kr";
import { MFDS_FEEDS, mfdsRssAdapter } from "./mfds-rss";
import { PAGE_WATCH_TARGETS, pageWatchAdapter } from "./page-watch";
import type { SourceAdapter } from "./types";

export function allAdapters(): SourceAdapter[] {
  return [
    ...Object.keys(MFDS_FEEDS).map(mfdsRssAdapter),
    lawGoKrAdapter,
    federalRegisterAdapter,
    ...PAGE_WATCH_TARGETS.map(pageWatchAdapter),
  ];
}

export type { RawUpdate, SourceAdapter } from "./types";
