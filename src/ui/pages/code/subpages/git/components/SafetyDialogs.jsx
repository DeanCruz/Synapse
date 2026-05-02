import React, { useState, useEffect, useCallback, useRef } from 'react';

function DangerIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M10 2L18 17H2L10 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M10 8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14.5" r="0.8" fill="currentColor" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" />
    </svg>
  );
}

function SafeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10l2.5 2.5L13.5 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LEVEL_ICONS = {
  danger: DangerIcon,
  warning: WarningIcon,
  safe: SafeIcon,
};

export function ConfirmDialog({
  isOpen,
  open,
  title,
  message,
  dangerLevel,
  level,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmText = null,
  affectedItems,
  loading = false,
  onConfirm,
  onCancel,
}) {
  const isVisible = isOpen ?? open ?? false;
  const dangerLvl = dangerLevel || level || 'warning';
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);
  const requiresTyping = !!confirmText;
  const canConfirm = !requiresTyping || typed === confirmText;

  useEffect(() => {
    if (isVisible) setTyped('');
  }, [isVisible]);

  useEffect(() => {
    if (isVisible && requiresTyping && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible, requiresTyping]);

  useEffect(() => {
    if (!isVisible) return;
    const handler = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel?.();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isVisible, onCancel]);

  if (!isVisible) return null;

  const LevelIcon = LEVEL_ICONS[dangerLvl] || WarningIcon;
  const confirmBtnClass = `git-manager-dialog-btn confirm-${dangerLvl}`;

  return (
    <div className="git-manager-dialog-overlay" onClick={onCancel}>
      <div
        className={`git-manager-dialog ${dangerLvl}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="git-manager-dialog-header">
          <div className="git-manager-dialog-icon">
            <LevelIcon />
          </div>
          <div className="git-manager-dialog-title">{title}</div>
        </div>

        <div className="git-manager-dialog-body">
          <div>{message}</div>
          {affectedItems && affectedItems.length > 0 && (
            <div className="git-manager-dialog-affected">
              {affectedItems.map((item, i) => (
                <div key={i}>{item}</div>
              ))}
            </div>
          )}
          {requiresTyping && (
            <div style={{ marginTop: '12px' }}>
              <div style={{
                fontSize: '0.72rem',
                color: 'var(--text-tertiary)',
                marginBottom: '6px',
              }}>
                Type <strong style={{ color: 'var(--color-failed)' }}>{confirmText}</strong> to confirm:
              </div>
              <input
                ref={inputRef}
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={confirmText}
                spellCheck={false}
                autoComplete="off"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canConfirm && !loading) onConfirm?.();
                }}
                style={{
                  width: '100%',
                  height: '32px',
                  padding: '0 10px',
                  border: '1px solid var(--border)',
                  borderRadius: '6px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  color: 'var(--text)',
                  fontFamily: "'SF Mono', 'Fira Code', monospace",
                  fontSize: '0.78rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}
        </div>

        <div className="git-manager-dialog-footer">
          <button
            className="git-manager-dialog-btn cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            className={confirmBtnClass}
            onClick={onConfirm}
            disabled={loading || !canConfirm}
            style={!canConfirm ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
          >
            {loading && (
              <span className="git-manager-spinner sm">
                <span className="git-manager-spinner-circle" />
              </span>
            )}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DoubleConfirmDialog({
  isOpen,
  open,
  title,
  message,
  secondTitle = 'Are you absolutely sure?',
  secondMessage,
  dangerLevel,
  level,
  confirmLabel = 'Continue',
  secondConfirmLabel = 'Yes, I am sure',
  cancelLabel = 'Cancel',
  confirmText = null,
  affectedItems,
  loading = false,
  onConfirm,
  onCancel,
}) {
  const isVisible = isOpen ?? open ?? false;
  const dangerLvl = dangerLevel || level || 'danger';
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (!isVisible) setStep(1);
  }, [isVisible]);

  const handleFirstConfirm = useCallback(() => {
    setStep(2);
  }, []);

  const handleCancel = useCallback(() => {
    setStep(1);
    onCancel?.();
  }, [onCancel]);

  if (!isVisible) return null;

  if (step === 1) {
    return (
      <ConfirmDialog
        isOpen={true}
        title={title}
        message={message}
        dangerLevel={dangerLvl}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        affectedItems={affectedItems}
        loading={false}
        onConfirm={handleFirstConfirm}
        onCancel={handleCancel}
      />
    );
  }

  return (
    <ConfirmDialog
      isOpen={true}
      title={secondTitle}
      message={secondMessage || 'This action cannot be undone. All changes will be permanently lost.'}
      dangerLevel={dangerLvl}
      confirmLabel={secondConfirmLabel}
      cancelLabel={cancelLabel}
      confirmText={confirmText}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={handleCancel}
    />
  );
}

export default ConfirmDialog;
