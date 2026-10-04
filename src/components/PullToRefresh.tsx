'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

// Native-style pull-to-refresh for the PWA: drag down from the top of the page
// and all React Query data refetches, so you never have to close the app to see
// fresh numbers. Only arms when the page is scrolled to the very top.
const THRESHOLD = 70; // px the user must pull before a refresh fires
const MAX_PULL = 110; // visual cap so the indicator doesn't slide off-screen

export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const refreshingRef = useRef(false);
  const pullRef = useRef(0);
  const [gestureActive, setGestureActive] = useState(false);

  useEffect(() => {
    function onTouchStart(e: TouchEvent) {
      if (refreshingRef.current) return;
      // Don't arm inside an open sheet/dialog. Otherwise a downward drag there
      // (the sheet's drag-to-dismiss grabber, or scrolling its content from the
      // top) would double as a page refresh.
      const target = e.target as Element | null;
      if (target?.closest('[data-slot="sheet-content"], [role="dialog"]')) {
        startY.current = null;
        setGestureActive(false);
        return;
      }
      // Only arm the gesture when the page is at the top.
      if (window.scrollY <= 0 && e.touches.length === 1) {
        startY.current = e.touches[0].clientY;
        setGestureActive(true);
      } else {
        startY.current = null;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current === null || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy > 0 && window.scrollY <= 0) {
        // Resistance: the further you pull, the slower it moves.
        const dist = Math.min(MAX_PULL, dy * 0.5);
        pullRef.current = dist;
        setPull(dist);
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    async function onTouchEnd() {
      if (startY.current === null || refreshingRef.current) return;
      const shouldRefresh = pullRef.current >= THRESHOLD;
      startY.current = null;
      setGestureActive(false);
      if (shouldRefresh) {
        refreshingRef.current = true;
        setRefreshing(true);
        setPull(THRESHOLD);
        try {
          await qc.refetchQueries({ type: 'active' });
          toast.success('Đã cập nhật dữ liệu');
        } catch {
          toast.error('Không thể cập nhật');
        } finally {
          refreshingRef.current = false;
          pullRef.current = 0;
          setRefreshing(false);
          setPull(0);
        }
      } else {
        pullRef.current = 0;
        setPull(0);
      }
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd);
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [qc]);

  const ready = pull >= THRESHOLD;
  return (
    <>
      <div
        className="fixed top-0 inset-x-0 z-40 flex items-end justify-center pointer-events-none overflow-hidden"
        style={{ height: pull, transition: gestureActive ? 'none' : 'height 0.2s ease' }}
      >
        <div
          className="mb-2 w-9 h-9 rounded-full flex items-center justify-center text-lg shadow-sm"
          style={{
            background: '#FFFFFF', boxShadow: 'var(--shadow-card)',
            opacity: pull > 8 ? 1 : 0,
            transform: refreshing ? 'none' : `rotate(${pull * 3}deg)`,
          }}
        >
          <span className={refreshing ? 'animate-spin' : ''}>{refreshing ? '⟳' : ready ? '↑' : '↓'}</span>
        </div>
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: gestureActive ? 'none' : 'transform 0.2s ease',
        }}
      >
        {children}
      </div>
    </>
  );
}
