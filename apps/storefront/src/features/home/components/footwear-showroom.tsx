'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Expand, MoveHorizontal, X } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { rupees } from '@/lib/format';
import type { ShowroomProduct } from '../data/showroom-products';
import styles from './footwear-showroom.module.css';

export function FootwearShowroom({ products }: { products: readonly ShowroomProduct[] }) {
  const first = Math.max(
    0,
    products.findIndex((product) => product.code === 'A15'),
  );
  const [active, setActive] = useState(first);
  const [turned, setTurned] = useState<number | null>(null);
  const [quickView, setQuickView] = useState<number | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const selected = useRef(first);
  const browsed = useRef(false);
  const trigger = useRef<HTMLElement>(null);
  const gesture = useRef({ pointer: -1, x: 0, y: 0, left: 0, dragging: false, moved: false });

  function centre(index: number, immediate = false) {
    const track = rail.current;
    const slide = track?.children[index] as HTMLElement | undefined;
    if (!track || !slide) return;
    const left = slide.offsetLeft + (slide.offsetWidth - track.clientWidth) / 2;
    track.scrollTo({
      left,
      behavior:
        immediate || matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }

  useLayoutEffect(() => {
    const track = rail.current;
    if (!track) return;
    track.dataset.ready = 'true';
    centre(selected.current, true);
    let width = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth === width) return;
      width = track.clientWidth;
      centre(selected.current, true);
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  function nearest(track: HTMLDivElement) {
    const midpoint = track.scrollLeft + track.clientWidth / 2;
    let best = selected.current;
    let distance = Infinity;
    for (const [index, slide] of Array.from(
      track.children as HTMLCollectionOf<HTMLElement>,
    ).entries()) {
      const offset = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - midpoint);
      if (offset < distance) {
        best = index;
        distance = offset;
      }
    }
    return best;
  }

  function onScroll(track: HTMLDivElement) {
    const index = nearest(track);
    if (index === selected.current) return;
    if (!browsed.current) {
      centre(selected.current, true);
      return;
    }
    selected.current = index;
    setActive(index);
    setTurned((view) => (view === index ? view : null));
  }

  function move(index: number) {
    browsed.current = true;
    setTurned(null);
    centre(Math.max(0, Math.min(index, products.length - 1)));
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const index = {
      ArrowLeft: active - 1,
      ArrowRight: active + 1,
      Home: 0,
      End: products.length - 1,
    }[event.key];
    if (index === undefined) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    move(index);
  }

  function start(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    browsed.current = true;
    gesture.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      dragging: false,
      moved: false,
    };
  }

  function drag(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (state.pointer !== event.pointerId) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.hypot(dx, dy) > 8) state.moved = true;
    if (event.pointerType !== 'mouse') return;
    if (!state.dragging && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      state.dragging = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.dataset.dragging = 'true';
      setTurned(null);
    }
    if (state.dragging) event.currentTarget.scrollLeft = state.left - dx;
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (state.pointer !== event.pointerId) return;
    state.pointer = -1;
    if (event.type === 'pointercancel') state.moved = true;
    if (!state.dragging) return;
    const index = nearest(event.currentTarget);
    delete event.currentTarget.dataset.dragging;
    centre(index);
  }

  function open(index: number, source: HTMLElement) {
    centre(index, true);
    trigger.current = source;
    setQuickView(index);
  }

  const product = products[active];
  const preview = quickView === null ? undefined : products[quickView];
  return (
    <section className={styles.showroom} aria-labelledby="footwear-showroom-title">
      <div className={styles.intro + ' container-page'}>
        <div>
          <p className={styles.eyebrow}>The Ajooba edit</p>
          <h1 id="footwear-showroom-title">
            Made for the <br className={styles.headlineBreak} />
            occasion<span>.</span>
          </h1>
        </div>
        <div className={styles.note}>
          <p className={styles.eyebrow}>The showroom</p>
          <p>From embroidered mojris to everyday sandals.</p>
        </div>
      </div>

      {product ? (
        <>
          <div
            ref={rail}
            className={styles.rail}
            data-initial-offset={first === 1 ? 'true' : undefined}
            role="region"
            aria-roledescription="carousel"
            aria-label="Footwear display. Use the arrow keys to browse."
            tabIndex={0}
            onScroll={(event) => onScroll(event.currentTarget)}
            onWheel={() => {
              browsed.current = true;
            }}
            onKeyDown={handleKey}
            onPointerDown={start}
            onPointerMove={drag}
            onPointerUp={finish}
            onPointerCancel={finish}
            onLostPointerCapture={finish}
            onDragStart={(event) => event.preventDefault()}
          >
            {products.map((item, index) => (
              <div
                key={item.code}
                className={styles.slide}
                data-active={active === index}
                role="group"
                aria-roledescription="slide"
                aria-label={item.name + ', ' + (index + 1) + ' of ' + products.length}
              >
                <button
                  type="button"
                  className={styles.shoe}
                  data-turned={turned === index}
                  tabIndex={active === index ? 0 : -1}
                  aria-label={(turned === index ? 'Inspect ' : 'Turn ') + item.name}
                  aria-haspopup={turned === index ? 'dialog' : undefined}
                  onClick={(event) => {
                    if (event.detail !== 0 && gesture.current.moved) return;
                    browsed.current = true;
                    if (turned === index && active === index) {
                      open(index, event.currentTarget);
                    } else {
                      if (active !== index) centre(index);
                      setTurned(index);
                    }
                  }}
                >
                  <span className={styles.photographs}>
                    <img
                      src={item.pair}
                      alt=""
                      width={680}
                      height={378}
                      draggable={false}
                      fetchPriority={index === first ? 'high' : 'auto'}
                      loading={Math.abs(index - first) <= 1 ? 'eager' : 'lazy'}
                    />
                    <img
                      src={item.detail}
                      alt=""
                      width={680}
                      height={378}
                      draggable={false}
                      loading={Math.abs(index - first) <= 1 ? 'eager' : 'lazy'}
                      className={styles.angle}
                    />
                  </span>
                  <span aria-hidden="true" className={styles.shelf} />
                  <span aria-hidden="true" className={styles.bracket} />
                </button>
              </div>
            ))}
          </div>

          <div className={styles.controls + ' container-page'}>
            <div className={styles.hint}>
              <MoveHorizontal size={17} aria-hidden="true" />
              <span className={styles.mouseHint}>Drag to browse</span>
              <span className={styles.touchHint}>Swipe · Tap to turn</span>
            </div>
            <div className={styles.navigation}>
              <button
                className={styles.arrow}
                type="button"
                aria-label="Previous design"
                disabled={active === 0}
                onClick={() => move(active - 1)}
              >
                <ArrowLeft size={19} aria-hidden="true" />
              </button>
              <div className={styles.caption} aria-live="polite" aria-atomic="true">
                <strong>{product.name}</strong>
                <span>
                  {product.colour} · {rupees(product.price)}
                </span>
              </div>
              <button
                className={styles.arrow}
                type="button"
                aria-label="Next design"
                disabled={active === products.length - 1}
                onClick={() => move(active + 1)}
              >
                <ArrowRight size={19} aria-hidden="true" />
              </button>
            </div>
            <button
              className={styles.quick}
              type="button"
              aria-haspopup="dialog"
              onClick={(event) => open(active, event.currentTarget)}
            >
              <Expand size={16} aria-hidden="true" /> Quick view
            </button>
          </div>
          <div className={styles.progress} aria-hidden="true">
            {products.map((item, index) => (
              <span key={item.code} data-current={active === index} />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.empty + ' container-page'}>
          <Link href="/products" className={styles.quick}>
            Explore footwear
          </Link>
        </div>
      )}
      {preview && (
        <ShowroomPreview
          key={preview.code}
          product={preview}
          initialDetail={turned === quickView}
          close={() => {
            setQuickView(null);
            trigger.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </section>
  );
}

function ShowroomPreview({
  product,
  initialDetail,
  close,
}: {
  product: ShowroomProduct;
  initialDetail: boolean;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [detail, setDetail] = useState(initialDetail);

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    panel.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => panel.close();
  }, []);

  function dismiss() {
    dialog.current?.close();
    close();
  }

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="showroom-preview-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <div className={styles.dialogInner}>
        <button
          ref={closeButton}
          type="button"
          className={styles.close}
          aria-label="Close quick view"
          onClick={dismiss}
        >
          <X size={20} aria-hidden="true" />
        </button>
        <div className={styles.previewGallery}>
          <img
            src={detail ? product.detail : product.pair}
            width={680}
            height={378}
            alt={
              product.name +
              ' in ' +
              product.colour.toLowerCase() +
              (detail ? ', side detail' : ', pair view')
            }
          />
          <div className={styles.viewOptions} role="group" aria-label="Product views">
            <button type="button" aria-pressed={!detail} onClick={() => setDetail(false)}>
              Pair view
            </button>
            <button type="button" aria-pressed={detail} onClick={() => setDetail(true)}>
              Side detail
            </button>
          </div>
        </div>
        <div className={styles.previewInfo}>
          <p className={styles.eyebrow}>
            {product.colour} · {product.code}
          </p>
          <h2 id="showroom-preview-title">{product.name}</h2>
          <p className={styles.price}>{rupees(product.price)}</p>
          <Link href={'/products/' + encodeURIComponent(product.slug)} className={styles.quick}>
            View product
          </Link>
        </div>
      </div>
    </dialog>
  );
}
