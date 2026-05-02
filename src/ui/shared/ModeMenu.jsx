import React, { useState, useRef, useEffect } from 'react';
import { useAppState, useDispatch } from '../context/AppContext.jsx';

export default function ModeMenu() {
  const { appMode } = useAppState();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function handleSelect(mode) {
    setOpen(false);
    if (mode !== appMode) dispatch({ type: 'SET_APP_MODE', mode });
  }

  return (
    <div className="mode-menu-wrap" ref={ref}>
      <button
        className="mode-menu-btn"
        onClick={() => setOpen(o => !o)}
        title="Switch mode"
        aria-label="Switch between Chat and Code modes"
      >
        {/* Hamburger-style menu icon */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
      {open && (
        <div className="mode-menu-dropdown">
          <button
            className={`mode-menu-item${appMode === 'chat' ? ' active' : ''}`}
            onClick={() => handleSelect('chat')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 3h12v8H6l-4 3v-3H2V3z" stroke="currentColor" strokeWidth="1.3"/>
            </svg>
            <span>Chat</span>
          </button>
          <button
            className={`mode-menu-item${appMode === 'code' ? ' active' : ''}`}
            onClick={() => handleSelect('code')}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M5.5 4L2 8l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10.5 4L14 8l-3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Code</span>
          </button>
        </div>
      )}
    </div>
  );
}
