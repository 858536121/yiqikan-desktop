import { useEffect, useRef, useState, useCallback } from "react";

const COLLAPSED_TOGGLE_SIZE = 48; // h-12 w-12 = 48px
const COLLAPSED_TOGGLE_MARGIN = 12;

function getCollapsedToggleRightEdgeLeft() {
  if (typeof window === "undefined") return 0;
  return Math.max(COLLAPSED_TOGGLE_MARGIN, window.innerWidth - COLLAPSED_TOGGLE_SIZE - COLLAPSED_TOGGLE_MARGIN);
}

function clampLeft(nextLeft: number) {
  return Math.min(Math.max(COLLAPSED_TOGGLE_MARGIN, nextLeft), getCollapsedToggleRightEdgeLeft());
}

function clampTop(nextTop: number) {
  if (typeof window === "undefined") return COLLAPSED_TOGGLE_MARGIN;
  const minTop = COLLAPSED_TOGGLE_MARGIN;
  const maxTop = Math.max(minTop, window.innerHeight - COLLAPSED_TOGGLE_SIZE - COLLAPSED_TOGGLE_MARGIN);
  return Math.min(Math.max(minTop, nextTop), maxTop);
}

export function useCollapsedToggleDrag() {
  const [top, setTop] = useState(() => {
    if (typeof window === "undefined") return COLLAPSED_TOGGLE_MARGIN;
    const saved = Number(localStorage.getItem("yiqikan:collapsedToggleTop"));
    return Number.isFinite(saved) ? saved : COLLAPSED_TOGGLE_MARGIN;
  });
  const [left, setLeft] = useState(() => getCollapsedToggleRightEdgeLeft());
  const [isDragging, setIsDragging] = useState(false);

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
  }>({
    active: false,
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
    function handlePointerMove(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;

      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        suppressClickRef.current = true;
      }

      const nextTop = clampTop(drag.startTop + deltaY);
      const nextLeft = clampLeft(drag.startLeft + deltaX);

      positionRef.current = { left: nextLeft, top: nextTop };

      const button = buttonRef.current;
      if (button) {
        button.style.transition = "none";
        button.style.left = `${nextLeft}px`;
        button.style.top = `${nextTop}px`;
      }
    }

    function handlePointerUp(event: PointerEvent) {
      const drag = dragRef.current;
      if (!drag.active || drag.pointerId !== event.pointerId) return;

      try {
        buttonRef.current?.releasePointerCapture?.(event.pointerId);
      } catch {}

      drag.active = false;
      drag.pointerId = null;
      setIsDragging(false);

      // 恢复 webview/iframe 交互和页面选区
      document.querySelectorAll("webview, iframe").forEach((el) => {
        (el as HTMLElement).style.pointerEvents = "";
      });
      document.body.style.userSelect = "";

      // 自动贴边吸附动画
      const nextTop = clampTop(positionRef.current.top);
      const nextLeft = getCollapsedToggleRightEdgeLeft();
      positionRef.current = { left: nextLeft, top: nextTop };

      const button = buttonRef.current;
      if (button) {
        button.style.transition = "left 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)";
        button.style.left = `${nextLeft}px`;
        button.style.top = `${nextTop}px`;
      }

      setTop(nextTop);
      setLeft(nextLeft);
    }

    function handleResize() {
      const nextTop = clampTop(positionRef.current.top);
      const nextLeft = getCollapsedToggleRightEdgeLeft();
      positionRef.current = { left: nextLeft, top: nextTop };

      const button = buttonRef.current;
      if (button) {
        button.style.transition = "none";
        button.style.left = `${nextLeft}px`;
        button.style.top = `${nextTop}px`;
      }
      setTop(nextTop);
      setLeft(nextLeft);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
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

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const currentLeft = positionRef.current.left;
    const currentTop = positionRef.current.top;

    dragRef.current = {
      active: true,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: currentLeft,
      startTop: currentTop,
    };
    suppressClickRef.current = false;
    setIsDragging(true);

    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {}

    // 拖拽时屏蔽所有 webview/iframe 的 pointer-events，防止拦截事件
    document.querySelectorAll("webview, iframe").forEach((el) => {
      (el as HTMLElement).style.pointerEvents = "none";
    });
    document.body.style.userSelect = "none";

    const button = buttonRef.current;
    if (button) {
      button.style.transition = "none";
    }
  }, []);

  return {
    top,
    left,
    isDragging,
    buttonRef,
    dragRef,
    positionRef,
    suppressClickRef,
    handlePointerDown,
  };
}
