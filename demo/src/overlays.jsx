import React, {useEffect} from 'react';
import {COPY, emptyState, overlayPattern} from './ui14.js';

export function EmptyState({kind, onAction, secondary}) {
  const spec = emptyState(kind);
  if (!spec) return null;
  return (
    <div className="empty-state" data-kind={spec.kind} role="status">
      {spec.illustration
        ? <img className="empty-art" src={spec.illustration} alt="" />
        : <div className={`empty-mark empty-mark-${spec.kind}`} aria-hidden="true" />}
      <h2>{spec.title}</h2>
      <p>{spec.body}</p>
      <div className="empty-actions">
        {spec.cta && <button className="btn-primary" type="button" onClick={() => onAction?.(spec)}>{spec.cta}</button>}
        {spec.secondaryCta && <button className="btn-secondary" type="button" onClick={() => secondary?.(spec)}>{spec.secondaryCta}</button>}
      </div>
    </div>
  );
}

export function Toast({text, onDone, durationMs = 1750}) {
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(() => onDone?.(), durationMs);
    return () => clearTimeout(timer);
  }, [text, durationMs, onDone]);
  if (!text) return null;
  return (
    <div className="toast" role="status" data-overlay="toast">
      <span className="toast-icon" aria-hidden="true">✓</span>
      <span>{text}</span>
    </div>
  );
}

export function Overlay({intent, viewport, title, body, confirmLabel, cancelLabel = '取消', destructive, children, onConfirm, onCancel}) {
  if (!intent) return null;
  const spec = overlayPattern(intent, viewport);
  const isToast = spec.pattern === 'toast';
  if (isToast) return null;
  const danger = destructive || spec.destructive;
  return (
    <div className={`overlay overlay-${spec.pattern}`} data-overlay={spec.pattern} data-backdrop={spec.backdrop}>
      <button type="button" className="overlay-scrim" aria-label="关闭" onClick={onCancel} />
      <div className={`overlay-panel${danger ? ' overlay-danger' : ''}`} role="dialog" aria-modal="true" aria-labelledby="overlay-title">
        {spec.pattern === 'sheet' && <div className="sheet-handle" aria-hidden="true" />}
        <button type="button" className="overlay-close" aria-label="关闭" onClick={onCancel}>×</button>
        {title && <h2 id="overlay-title">{title}</h2>}
        {body && <p className="overlay-body">{body}</p>}
        {children}
        {(onConfirm || onCancel) && (
          <div className="overlay-actions">
            {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>{cancelLabel}</button>}
            {onConfirm && (
              <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
                {confirmLabel || (danger ? '删除' : COPY.confirmPublish)}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
