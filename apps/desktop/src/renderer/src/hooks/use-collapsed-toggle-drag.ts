import { useEffect, useRef, useState } from "react";

const COLLAPSED_TOGGLE_SIZE = 40;
const COLLAPSED_TOGGLE_MARGIN = 8;

function getCollapsedToggleRightEdgeLeft() {
  return Math.max(COLLAPSED_TOGGLE_MARGIN, window.innerWidth - COLLAPSED_TOGGLE_SIZE - COLLAPSED_TOGGLE_MARGIN);
}

function clampLeft(nextLeft: number) {
  return Math.min(Math.max(COLLAPSED_TOGGLE_MARGIN, nextLeft), getCollapsedToggleRightEdgeLeft());
}

function clampTop(nextTop: number) {
  const minTop = COLLAPSED_TOGGLE_MARGIN;
  const maxTop = Math.max(minTop, window.innerHeight - COLLAPSED_TOGGLE_SIZE - COLLAPSED_TOGGLE_MARGIN);
  return Math.min(Math.max(minTop, nextTop), maxTop);
}

export function useCollapsedToggleDrag() {
  const [top, setTop] = useState(() => {
    const saved = Number(localStorage.getItem("yiqikan:collapsedToggleTop"));
    return Number.isFinite(saved) ? saved : COLLAPSED_TOGGLE_MARGIN;
  });
  const [left, setLeft] = useState(() => getCollapsedToggleRightEdgeLeft());

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startLeft: getCollapsedToggleRightEdgeLeft(),
    startTop: COLLAPSED_TOGGLE_MARGIN,
  });
  const positionRef = useRef({ left: getCollapsedToggleRightEdgeLeft(), top: COLLAPSED_TOGGLE_MARGIN });
  const suppressClickRef = useRef(false);

  useEffect(() => {
    localStorage.setItem("yiqikan:collapsedToggleTop", String(top));
  }, [top]);

  useEffect(() => {
    positionRef.current = { left, top };
  }, [left, top]);

  useEffect(() => {
    function applyPosition(nextLeft: number, nextTop: number) {
      const button = buttonRef.current;
      if (!button) return;
      button.style.left = `${nextLeft}px`;
      button.style.top = `${nextTop}px`;
    }

    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      const nextTop = clampTop(drag.startTop + event.clientY - drag.startY);
      const nextLeft = clampLeft(drag.startLeft + event.clientX - drag.startX);
      if (Math.abs(nextTop - drag.startTop) > 3 || Math.abs(nextLeft - drag.startLeft) > 3) {
        suppressClickRef.current = true;
      }
      positionRef.current = { left: nextLeft, top: nextTop };
      applyPosition(nextLeft, nextTop);
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (drag.pointerId !== event.pointerId) return;
      buttonRef.current?.releasePointerCapture?.(event.pointerId);
      drag.pointerId = null;
      const nextTop = clampTop(positionRef.current.top);
      const nextLeft = getCollapsedToggleRightEdgeLeft();
      positionRef.current = { left: nextLeft, top: nextTop };
      applyPosition(nextLeft, nextTop);
      setTop(nextTop);
      setLeft(nextLeft);
    }

    function handleResize() {
      const nextTop = clampTop(positionRef.current.top);
      const nextLeft = getCollapsedToggleRightEdgeLeft();
      positionRef.current = { left: nextLeft, top: nextTop };
      setTop(nextTop);
      setLeft(nextLeft);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return { top, left, buttonRef, dragRef, positionRef, suppressClickRef };
}
