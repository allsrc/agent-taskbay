"use client";

import { useEffect, useRef, type RefObject } from "react";

/** The pane when it is the thing that scrolls, otherwise null (the page scrolls). */
const scrollingPane = (pane: HTMLElement | null) => (pane && getComputedStyle(pane).overflowY !== "visible" ? pane : null);

function metrics(pane: HTMLElement | null) {
  const scrolling = scrollingPane(pane);
  return scrolling
    ? { top: scrolling.scrollTop, view: scrolling.clientHeight, total: scrolling.scrollHeight }
    : { top: window.scrollY, view: window.innerHeight, total: document.documentElement.scrollHeight };
}

function scrollToBottom(pane: HTMLElement | null) {
  const scrolling = scrollingPane(pane);
  if (scrolling) scrolling.scrollTo({ top: scrolling.scrollHeight });
  else window.scrollTo(0, document.documentElement.scrollHeight);
}

/** How close to the end still counts as "at the bottom", so a small overscroll or a rounding error does not unstick. */
const NEAR_BOTTOM = 80;

/**
 * Keeps a chat scrolled to its newest content, the way messaging apps do. It follows while you are at the bottom, however
 * the content grows (messages arriving, Markdown and folded blocks laying out, the composer gaining a row), and stops
 * following when you scroll up to read. `follow()` jumps back to the bottom and resumes, for example after you send.
 *
 * From the `md` breakpoint the message pane (`scroller`) scrolls by itself; below it the whole page scrolls, with the
 * composer sticky at the bottom, so the end of the page is where the last message sits just above it. Which one scrolls is
 * read from the element's computed style rather than a breakpoint, so it stays right wherever the layout switches.
 */
export function useStickToBottom({ scroller, watch }: { scroller: RefObject<HTMLElement | null>; watch: Array<RefObject<HTMLElement | null>> }) {
  const stuck = useRef(true);

  useEffect(() => {
    const pane = scroller.current;
    const onScroll = () => {
      const { top, view, total } = metrics(pane);
      stuck.current = total - top - view < NEAR_BOTTOM;
    };
    // Either may be the one that scrolls, and the layout can switch between them when the window is resized.
    pane?.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      pane?.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll);
    };
  }, [scroller]);

  useEffect(() => {
    const pane = scroller.current;
    const elements = watch.map((ref) => ref.current).filter((element): element is HTMLElement => Boolean(element));
    const observer = new ResizeObserver(() => {
      if (stuck.current) scrollToBottom(pane);
    });
    for (const element of elements) observer.observe(element);
    if (stuck.current) scrollToBottom(pane);
    return () => observer.disconnect();
    // The refs are stable, so the observer is set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroller]);

  return {
    /** Scrolls to the newest content and keeps following it. */
    follow: () => {
      stuck.current = true;
      scrollToBottom(scroller.current);
    },
  };
}
